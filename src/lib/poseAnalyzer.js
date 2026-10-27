/**
 * poseAnalyzer.js
 *
 * Multi-zone movement detection using MediaPipe Pose landmarks.
 * Analyzes motion across distinct anatomical zones:
 *  - Head (nose, eyes, ears)
 *  - Torso & Centroid (shoulders, hips, center of mass)
 *  - Arms (elbows, wrists)
 *  - Legs (knees, ankles)
 *
 * Implements two complementary detection modes:
 *  1. Dynamic / Velocity: Short-window frame displacement with zone weightings
 *  2. Anchor Drift: Deviation from the frozen posture recorded at game start
 */

import {
  TRACKED_LANDMARK_INDICES,
  HEAD_LANDMARK_INDICES,
  TORSO_LANDMARK_INDICES,
  ARMS_LANDMARK_INDICES,
  LEGS_LANDMARK_INDICES,
  ZONE_WEIGHTS,
  MIN_LANDMARK_VISIBILITY,
  MOVEMENT_WINDOW_FRAMES,
  LANDMARK_SMOOTHING_MIN_ALPHA,
  LANDMARK_SMOOTHING_GAIN,
  LANDMARK_NOISE_FLOOR,
  VISIBILITY_DECAY_ALPHA,
  SCORE_MEDIAN_WINDOW,
  ANCHOR_SAMPLE_FRAMES,
  ANALYZER_WARMUP_FRAMES,
  STABILITY_CALIBRATION_FRAMES,
  UNSTABLE_RELATIVE_FACTOR,
  UNSTABLE_ABSOLUTE_FLOOR,
  FRAME_BOUNDS_MARGIN,
  MIN_ZONE_COVERAGE_RATIO,
  REFERENCE_SHOULDER_WIDTH,
  REFERENCE_HEAD_WIDTH,
  MIN_BODY_SCALE,
  MAX_BODY_SCALE,
} from './constants.js';

/**
 * Calculate Euclidean displacement between two landmark points.
 */
function pointDistance(a, b) {
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Whether a landmark can be trusted for measurement.
 *
 * Two ways it cannot: low reported confidence, or a position outside the
 * frame. The second matters for close-up framing, where MediaPipe still
 * reports hips and knees it has never seen — guesses that jump around
 * between frames and read as movement from a player who has not moved.
 */
export function isLandmarkUsable(lm) {
  if (!lm) return false;
  if ((lm.visibility ?? 1) < MIN_LANDMARK_VISIBILITY) return false;
  const lo = -FRAME_BOUNDS_MARGIN;
  const hi = 1 + FRAME_BOUNDS_MARGIN;
  return lm.x >= lo && lm.x <= hi && lm.y >= lo && lm.y <= hi;
}

/**
 * Calculate body scale factor from apparent body size, so the same physical
 * movement scores the same whether the player fills the frame or stands back.
 *
 * Shoulder width is the primary measure. In a head-and-shoulders close-up the
 * shoulders are out of frame or merely guessed, so head width (ear to ear) is
 * used instead — without it, a close-up is read at roughly twice its true
 * sensitivity and the smallest movement ends the round.
 */
export function calculateBodyScale(landmarks) {
  if (!landmarks) return 1.0;

  let scale = null;

  const ls = landmarks[11];
  const rs = landmarks[12];
  if (isLandmarkUsable(ls) && isLandmarkUsable(rs)) {
    const dist = pointDistance(ls, rs);
    if (dist >= 0.05) scale = dist / REFERENCE_SHOULDER_WIDTH;
  }

  if (scale === null) {
    const le = landmarks[7];
    const re = landmarks[8];
    if (isLandmarkUsable(le) && isLandmarkUsable(re)) {
      const dist = pointDistance(le, re);
      if (dist >= 0.02) scale = dist / REFERENCE_HEAD_WIDTH;
    }
  }

  if (scale === null) return 1.0;
  // Larger apparent body -> larger scale -> displacement divided by more
  return Math.max(MIN_BODY_SCALE, Math.min(MAX_BODY_SCALE, scale));
}

/**
 * Calculate average displacement and max displacement for a specific anatomical zone.
 */
export function calculateZoneDisplacement(current, previous, indices, scale = 1.0, excluded = null) {
  if (!current || !previous) return { displacement: 0, maxDisplacement: 0, validCount: 0 };

  const distances = [];

  for (const idx of indices) {
    if (excluded && excluded.has(idx)) continue;

    const curr = current[idx];
    const prev = previous[idx];
    if (!curr || !prev) continue;

    if (!isLandmarkUsable(curr) || !isLandmarkUsable(prev)) continue;

    distances.push(Math.max(0, pointDistance(curr, prev) / scale - LANDMARK_NOISE_FLOOR));
  }

  if (distances.length === 0) return { displacement: 0, maxDisplacement: 0, validCount: 0 };

  // Median, not mean: with four landmarks to a zone, one bad point would drag
  // a mean over the threshold on its own. The median ignores it.
  return {
    displacement: median(distances),
    maxDisplacement: Math.max(...distances),
    validCount: distances.length,
  };
}

/**
 * Calculate the centroid (center of mass) of specific landmarks (e.g. torso).
 */
export function calculateCentroid(landmarks, indices) {
  if (!landmarks) return null;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!isLandmarkUsable(lm)) continue;
    sumX += lm.x;
    sumY += lm.y;
    count++;
  }

  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

/**
 * Translation of a group of landmarks between two frames.
 *
 * Averages the displacement VECTORS of the landmarks visible in both frames,
 * rather than differencing two independently-built centroids. Comparing two
 * centroids breaks down when a landmark drops below the visibility gate: the
 * average is then taken over a different set of points and jumps by several
 * centimetres although nobody moved. Averaging paired displacements is immune
 * to that, and still cancels per-landmark jitter the way a centroid does.
 */
export function calculateGroupTranslation(current, previous, indices, scale = 1.0, excluded = null) {
  if (!current || !previous) return 0;

  let sumDx = 0;
  let sumDy = 0;
  let count = 0;

  for (const idx of indices) {
    if (excluded && excluded.has(idx)) continue;

    const curr = current[idx];
    const prev = previous[idx];
    if (!curr || !prev) continue;
    if (!isLandmarkUsable(curr) || !isLandmarkUsable(prev)) continue;

    sumDx += curr.x - prev.x;
    sumDy += curr.y - prev.y;
    count++;
  }

  if (count === 0) return 0;
  return Math.max(0, Math.hypot(sumDx / count, sumDy / count) / scale - LANDMARK_NOISE_FLOOR);
}

/**
 * Whether a zone has enough usable landmarks for its score to mean anything.
 * Below that, a single guessed point would otherwise speak for a whole limb.
 */
function hasZoneCoverage(validCount, indices) {
  return validCount >= Math.max(2, Math.ceil(indices.length * MIN_ZONE_COVERAGE_RATIO));
}

/**
 * Multi-zone movement analysis between two frames.
 * Returns the peak weighted movement score and the identifying infraction zone.
 */
export function analyzeMovement(current, previous, excluded = null) {
  if (!current || !previous || current.length === 0 || previous.length === 0) {
    return { score: 0, activeZone: null, zoneScores: {} };
  }

  const scale = calculateBodyScale(current);

  // A zone out of frame scores 0 rather than contributing the noise of
  // landmarks MediaPipe is guessing at.

  // 1. Head movement
  const headData = calculateZoneDisplacement(current, previous, HEAD_LANDMARK_INDICES, scale, excluded);
  const headScore = hasZoneCoverage(headData.validCount, HEAD_LANDMARK_INDICES)
    ? headData.displacement * ZONE_WEIGHTS.head
    : 0;

  // 2. Torso landmark displacement & Torso Centroid translation
  const torsoData = calculateZoneDisplacement(current, previous, TORSO_LANDMARK_INDICES, scale, excluded);
  const centroidDist = calculateGroupTranslation(current, previous, TORSO_LANDMARK_INDICES, scale, excluded);
  const torsoScore = hasZoneCoverage(torsoData.validCount, TORSO_LANDMARK_INDICES)
    ? Math.max(torsoData.displacement, centroidDist) * ZONE_WEIGHTS.torso
    : 0;

  // 3. Arms movement
  const armsData = calculateZoneDisplacement(current, previous, ARMS_LANDMARK_INDICES, scale, excluded);
  const armsScore = hasZoneCoverage(armsData.validCount, ARMS_LANDMARK_INDICES)
    ? armsData.displacement * ZONE_WEIGHTS.arms
    : 0;

  // 4. Legs movement
  const legsData = calculateZoneDisplacement(current, previous, LEGS_LANDMARK_INDICES, scale, excluded);
  const legsScore = hasZoneCoverage(legsData.validCount, LEGS_LANDMARK_INDICES)
    ? legsData.displacement * ZONE_WEIGHTS.legs
    : 0;

  // Find peak movement zone
  const scores = [
    { zone: 'head', name: 'Movimiento de cabeza', score: headScore },
    { zone: 'torso', name: 'Movimiento del cuerpo', score: torsoScore },
    { zone: 'arms', name: 'Movimiento de brazos', score: armsScore },
    { zone: 'legs', name: 'Movimiento de piernas', score: legsScore },
  ];

  scores.sort((a, b) => b.score - a.score);
  const peak = scores[0];

  return {
    score: peak.score,
    activeZone: peak.zone,
    reason: peak.name,
    zoneScores: {
      head: headScore,
      torso: torsoScore,
      centroid: centroidDist * ZONE_WEIGHTS.torso,
      arms: armsScore,
      legs: legsScore,
    },
  };
}

/**
 * Calculate static drift from the anchor (initial freeze pose).
 * Detects slow drift/creeping movements that frame-by-frame diffs might miss.
 */
export function calculateAnchorDrift(current, anchor, excluded = null) {
  if (!current || !anchor) return { drift: 0, reason: null };

  const scale = calculateBodyScale(current);

  // Head drift from start
  const headData = calculateZoneDisplacement(current, anchor, HEAD_LANDMARK_INDICES, scale, excluded);
  const headDrift = hasZoneCoverage(headData.validCount, HEAD_LANDMARK_INDICES)
    ? headData.displacement * ZONE_WEIGHTS.head
    : 0;

  // Body/Torso centroid drift from start
  const torsoData = calculateZoneDisplacement(current, anchor, TORSO_LANDMARK_INDICES, scale, excluded);
  const centroidDrift = hasZoneCoverage(torsoData.validCount, TORSO_LANDMARK_INDICES)
    ? calculateGroupTranslation(current, anchor, TORSO_LANDMARK_INDICES, scale, excluded) * ZONE_WEIGHTS.torso
    : 0;

  // Arms drift from start
  const armsData = calculateZoneDisplacement(current, anchor, ARMS_LANDMARK_INDICES, scale, excluded);
  const armsDrift = hasZoneCoverage(armsData.validCount, ARMS_LANDMARK_INDICES)
    ? armsData.displacement * ZONE_WEIGHTS.arms
    : 0;

  const drifts = [
    { zone: 'head', name: 'Movimiento de cabeza (postura cambiada)', drift: headDrift },
    { zone: 'torso', name: 'Desplazamiento del cuerpo (saliste de posición)', drift: centroidDrift },
    { zone: 'arms', name: 'Movimiento de brazos', drift: armsDrift },
  ];

  drifts.sort((a, b) => b.drift - a.drift);
  return {
    drift: drifts[0].drift,
    reason: drifts[0].name,
    zone: drifts[0].zone,
    driftScores: { head: headDrift, torso: centroidDrift, arms: armsDrift },
    validCounts: {
      head: headData.validCount,
      torso: torsoData.validCount,
      arms: armsData.validCount,
    },
  };
}

/**
 * Median of a numeric list. Used instead of a mean so that a single noisy
 * frame cannot drag the movement score over the threshold.
 */
function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Adaptive exponential smoothing of a landmark set.
 *
 * Small frame-to-frame displacements (detector jitter) are damped heavily,
 * while large ones (real movement) pass through nearly unfiltered, so the
 * filter removes noise without hiding actual motion.
 *
 * A landmark that momentarily drops below the visibility gate keeps its last
 * known position and lets its visibility decay, so the set of landmarks used
 * for averaging stays stable instead of flickering in and out.
 */
export function smoothLandmarks(raw, previous) {
  if (!raw) return null;
  if (!previous) return raw.map((lm) => (lm ? { ...lm } : lm));

  return raw.map((lm, i) => {
    const prev = previous[i];
    if (!lm) return prev ?? lm;
    if (!prev) return { ...lm };

    const rawVisibility = lm.visibility ?? 1;

    // Low confidence: the reported position is unreliable, so track it only
    // weakly and let the confidence decay. Keeping the point moving (instead
    // of freezing it) means it does not snap back when confidence returns,
    // and the decay gives the visibility gate hysteresis so a one- or
    // two-frame dropout does not change which landmarks are averaged.
    if (rawVisibility < MIN_LANDMARK_VISIBILITY) {
      return {
        ...prev,
        x: prev.x + (lm.x - prev.x) * VISIBILITY_DECAY_ALPHA,
        y: prev.y + (lm.y - prev.y) * VISIBILITY_DECAY_ALPHA,
        visibility: prev.visibility + (rawVisibility - prev.visibility) * VISIBILITY_DECAY_ALPHA,
      };
    }

    const delta = pointDistance(prev, lm);
    const alpha = Math.min(1, LANDMARK_SMOOTHING_MIN_ALPHA + delta * LANDMARK_SMOOTHING_GAIN);

    return {
      ...lm,
      x: prev.x + (lm.x - prev.x) * alpha,
      y: prev.y + (lm.y - prev.y) * alpha,
      visibility: rawVisibility,
    };
  });
}

/**
 * Average several landmark sets into one. Used to build the freeze anchor
 * from a handful of frames rather than a single arbitrary one.
 */
export function averageLandmarkSets(sets) {
  if (!sets || sets.length === 0) return null;
  const length = sets[0].length;
  const out = [];

  for (let i = 0; i < length; i++) {
    let sumX = 0;
    let sumY = 0;
    let sumVis = 0;
    let count = 0;

    for (const set of sets) {
      const lm = set[i];
      if (!lm) continue;
      sumX += lm.x;
      sumY += lm.y;
      sumVis += lm.visibility ?? 1;
      count++;
    }

    out.push(count ? { x: sumX / count, y: sumY / count, visibility: sumVis / count } : null);
  }

  return out;
}

/**
 * MovementAnalyzer
 *
 * Stateful class that maintains a temporal sliding window buffer of landmarks
 * and compares against an anchor freeze pose.
 *
 * Noise handling, in order:
 *  1. Incoming landmarks are smoothed with an adaptive EMA.
 *  2. The anchor is averaged over the first few frames of the round.
 *  3. Scores are median-filtered so isolated spikes are discarded.
 *  4. Results stay invalid during a short warm-up while the filters settle.
 */
export class MovementAnalyzer {
  constructor(windowFrames = MOVEMENT_WINDOW_FRAMES) {
    this._windowFrames = windowFrames;
    this._history = [];
    this._anchorLandmarks = null;
    this._anchorSamples = null;
    this._recentScores = [];
    this._recentDrifts = [];
    this._smoothed = null;
    this._frameCount = 0;
    this._stabilityAcc = new Map();
    this._unstableLandmarks = new Set();
  }

  /**
   * Decide which landmarks are too restless to measure.
   *
   * Run once, at the end of calibration. A landmark counts as unstable when
   * it moved far more than the body typically did AND cleared an absolute
   * floor — the relative test finds inferred points whatever the framing,
   * and the absolute floor stops a perfectly still body from flagging
   * everything just because its median is near zero.
   */
  _classifyStability() {
    const means = new Map();
    for (const [idx, samples] of this._stabilityAcc) {
      if (samples.length < 3) continue;
      means.set(idx, samples.reduce((a, b) => a + b, 0) / samples.length);
    }
    if (means.size === 0) return;

    const bodyMedian = median([...means.values()]);
    const limit = Math.max(UNSTABLE_ABSOLUTE_FLOOR, bodyMedian * UNSTABLE_RELATIVE_FACTOR);

    this._unstableLandmarks = new Set();
    for (const [idx, mean] of means) {
      if (mean > limit) this._unstableLandmarks.add(idx);
    }
  }

  /**
   * Begin anchoring the freeze pose. The anchor keeps averaging in the next
   * ANCHOR_SAMPLE_FRAMES frames so a single noisy frame cannot bias it.
   */
  setAnchor(landmarks) {
    if (!landmarks) {
      this._anchorLandmarks = null;
      this._anchorSamples = null;
      return;
    }
    const snapshot = landmarks.map((lm) => (lm ? { ...lm } : lm));
    this._anchorSamples = [snapshot];
    this._anchorLandmarks = snapshot;
  }

  /**
   * Feed new frame landmarks and calculate composite movement.
   */
  update(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      return { score: 0, anchorDrift: 0, isValid: false, reason: null };
    }

    // 1. Smooth away detector jitter before anything is measured.
    const prevSmoothed = this._smoothed;
    const smoothed = smoothLandmarks(landmarks, this._smoothed);
    this._smoothed = smoothed;
    this._frameCount++;

    // 1b. While calibrating, record how much each landmark moves on its own,
    //     so the restless ones can be dropped before scoring begins.
    if (this._frameCount <= STABILITY_CALIBRATION_FRAMES && prevSmoothed) {
      const calScale = calculateBodyScale(smoothed);
      for (const idx of TRACKED_LANDMARK_INDICES) {
        const curr = smoothed[idx];
        const prev = prevSmoothed[idx];
        if (!curr || !prev) continue;
        if (!isLandmarkUsable(curr) || !isLandmarkUsable(prev)) continue;

        if (!this._stabilityAcc.has(idx)) this._stabilityAcc.set(idx, []);
        this._stabilityAcc.get(idx).push(pointDistance(curr, prev) / calScale);
      }
      if (this._frameCount === STABILITY_CALIBRATION_FRAMES) this._classifyStability();
    }

    this._history.push(smoothed);
    if (this._history.length > this._windowFrames) {
      this._history.shift();
    }

    // 2. Keep refining the anchor over the opening frames of the round.
    if (this._anchorSamples && this._anchorSamples.length < ANCHOR_SAMPLE_FRAMES) {
      this._anchorSamples.push(smoothed);
      this._anchorLandmarks = averageLandmarkSets(this._anchorSamples);
    }

    if (this._history.length < 2) {
      return { score: 0, anchorDrift: 0, isValid: false, reason: null };
    }

    // Compare with the frame from (window - 1) frames ago (captures moderate velocities)
    const referenceFrame = this._history[0];
    const immediatePrevFrame = this._history[this._history.length - 2];

    const excluded = this._unstableLandmarks;
    const windowAnalysis = analyzeMovement(smoothed, referenceFrame, excluded);
    const immediateAnalysis = analyzeMovement(smoothed, immediatePrevFrame, excluded);

    // Dynamic movement score: peak of smoothed window displacement or sudden spike
    const rawScore = Math.max(windowAnalysis.score, immediateAnalysis.score);
    const reason = windowAnalysis.score >= immediateAnalysis.score ? windowAnalysis.reason : immediateAnalysis.reason;
    const activeZone = windowAnalysis.score >= immediateAnalysis.score ? windowAnalysis.activeZone : immediateAnalysis.activeZone;

    // 3. Median-filter the dynamic score: a lone spike is outvoted by its
    //    neighbours, while sustained movement survives intact.
    this._recentScores.push(rawScore);
    if (this._recentScores.length > SCORE_MEDIAN_WINDOW) this._recentScores.shift();
    const smoothedScore = median(this._recentScores);

    // Calculate static drift against initial freeze anchor pose
    let anchorDrift = 0;
    let anchorReason = null;
    let driftScores = null;
    let validCounts = null;
    if (this._anchorLandmarks) {
      const driftResult = calculateAnchorDrift(smoothed, this._anchorLandmarks, excluded);
      this._recentDrifts.push(driftResult.drift);
      if (this._recentDrifts.length > SCORE_MEDIAN_WINDOW) this._recentDrifts.shift();
      anchorDrift = median(this._recentDrifts);
      anchorReason = driftResult.reason;
      driftScores = driftResult.driftScores;
      validCounts = driftResult.validCounts;
    }

    // 4. Stay invalid until the smoother and the anchor have settled.
    const isValid =
      this._frameCount >= ANALYZER_WARMUP_FRAMES &&
      this._recentScores.length >= SCORE_MEDIAN_WINDOW;

    return {
      score: smoothedScore,
      anchorDrift,
      isValid,
      reason,
      anchorReason,
      activeZone,
      zoneScores: windowAnalysis.zoneScores,
      excludedLandmarks: [...excluded],
      bodyScale: calculateBodyScale(smoothed),
      driftScores,
      validCounts,
      frameCount: this._frameCount,
    };
  }

  reset() {
    this._history = [];
    this._recentScores = [];
    this._recentDrifts = [];
    this._anchorLandmarks = null;
    this._anchorSamples = null;
    this._smoothed = null;
    this._frameCount = 0;
    this._stabilityAcc = new Map();
    this._unstableLandmarks = new Set();
  }
}

/**
 * Backward compatibility helper for legacy calls.
 */
export function calculateMovementScore(current, previous) {
  const result = analyzeMovement(current, previous);
  return result.score;
}

/**
 * Extract a bounding box from pose landmarks in pixel coords.
 */
export function getLandmarkBoundingBox(landmarks, canvasW, canvasH, padding = 24) {
  if (!landmarks || landmarks.length === 0) return null;

  const visible = landmarks.filter(isLandmarkUsable);
  if (visible.length < 3) return null;

  const xs = visible.map((lm) => lm.x * canvasW);
  const ys = visible.map((lm) => lm.y * canvasH);

  const minX = Math.max(0, Math.min(...xs) - padding);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxX = Math.min(canvasW, Math.max(...xs) + padding);
  const maxY = Math.min(canvasH, Math.max(...ys) + padding);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Draw pose skeleton on canvas overlay, including head, torso, and limbs.
 */
export function drawSkeleton(ctx, landmarks, W, H, color = '#5b9cf5') {
  if (!landmarks) return;

  const CONNECTIONS = [
    // Head wireframe
    [0, 1], [0, 4],     // nose to inner eyes
    [1, 7], [4, 8],     // eyes to ears
    [0, 11], [0, 12],   // head to shoulders
    // Torso & Core
    [11, 12],           // shoulders
    [11, 23], [12, 24], // torso sides
    [23, 24],           // hips
    // Arms
    [11, 13], [13, 15], // left arm
    [12, 14], [14, 16], // right arm
    // Legs
    [23, 25], [25, 27], // left leg
    [24, 26], [26, 28], // right leg
  ];

  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.75;

  // Draw bone lines
  for (const [a, b] of CONNECTIONS) {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    // Only bones between landmarks the analyzer actually trusts, so the
    // overlay shows what is being measured rather than guessed limbs.
    if (!isLandmarkUsable(lmA) || !isLandmarkUsable(lmB)) continue;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(lmA.x * W, lmA.y * H);
    ctx.lineTo(lmB.x * W, lmB.y * H);
    ctx.stroke();
  }

  // Draw keypoint dots
  for (const idx of TRACKED_LANDMARK_INDICES) {
    const lm = landmarks[idx];
    if (!isLandmarkUsable(lm)) continue;
    ctx.beginPath();
    ctx.fillStyle = color;
    // Slightly larger dots for head (0, 7, 8) and core (11, 12)
    const isMajor = [0, 7, 8, 11, 12, 23, 24].includes(idx);
    ctx.arc(lm.x * W, lm.y * H, isMajor ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
