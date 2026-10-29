/**
 * poseAnalyzer.js
 *
 * Multi-zone movement detection and occlusion-resilient skeleton smoothing
 * using MediaPipe Pose landmarks.
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
  DISTAL_EXTREMITY_INDICES,
  ZONE_WEIGHTS,
  MIN_LANDMARK_VISIBILITY,
  MOVEMENT_WINDOW_FRAMES,
  DEFAULT_POSE_SMOOTHING,
  DEFAULT_OCCLUSION_DAMPING,
  DEFAULT_OCCLUSION_HOLD_MS,
  DEFAULT_HIDE_NOISY_EXTREMITIES,
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

const DISTAL_SET = new Set(DISTAL_EXTREMITY_INDICES);
const LOWER_BODY_SET = new Set(LEGS_LANDMARK_INDICES);

// Live runtime configuration synced from AdminScreen (#admin)
const runtimeConfig = {
  minLandmarkVisibility: MIN_LANDMARK_VISIBILITY,
  poseSmoothing: DEFAULT_POSE_SMOOTHING,
  occlusionDamping: DEFAULT_OCCLUSION_DAMPING,
  occlusionHoldMs: DEFAULT_OCCLUSION_HOLD_MS,
  hideNoisyExtremities: DEFAULT_HIDE_NOISY_EXTREMITIES,
  zoneWeights: { ...ZONE_WEIGHTS },
};

/**
 * Update runtime pose & analyzer parameters from Admin settings without touching code.
 */
export function setPoseRuntimeConfig(patch = {}) {
  if (Number.isFinite(patch.minLandmarkVisibility)) {
    runtimeConfig.minLandmarkVisibility = patch.minLandmarkVisibility;
  }
  if (Number.isFinite(patch.poseSmoothing)) {
    runtimeConfig.poseSmoothing = patch.poseSmoothing;
  }
  if (typeof patch.occlusionDamping === 'boolean') {
    runtimeConfig.occlusionDamping = patch.occlusionDamping;
  }
  if (Number.isFinite(patch.occlusionHoldMs)) {
    runtimeConfig.occlusionHoldMs = patch.occlusionHoldMs;
  }
  if (typeof patch.hideNoisyExtremities === 'boolean') {
    runtimeConfig.hideNoisyExtremities = patch.hideNoisyExtremities;
  }
  if (patch.zoneWeights && typeof patch.zoneWeights === 'object') {
    runtimeConfig.zoneWeights = {
      ...runtimeConfig.zoneWeights,
      ...patch.zoneWeights,
    };
  }
}

export function getPoseRuntimeConfig() {
  return runtimeConfig;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Calculate Euclidean displacement between two landmark points.
 */
export function pointDistance(a, b) {
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Whether a landmark lies inside the valid camera frame (with small margin).
 */
export function isLandmarkInFrame(lm) {
  if (!lm) return false;
  const lo = -FRAME_BOUNDS_MARGIN;
  const hi = 1 + FRAME_BOUNDS_MARGIN;
  return lm.x >= lo && lm.x <= hi && lm.y >= lo && lm.y <= hi;
}

/**
 * Minimum visibility required for a specific landmark index given current config.
 * Lower-body joints get a slightly stricter gate when `hideNoisyExtremities` is
 * enabled so knees/ankles behind a desk or podium are not hallucinated.
 */
function requiredVisibilityForIndex(idx, minVis = runtimeConfig.minLandmarkVisibility) {
  if (runtimeConfig.hideNoisyExtremities && idx != null) {
    if (DISTAL_SET.has(idx)) return 0.98;
    if (LOWER_BODY_SET.has(idx)) return Math.min(0.92, minVis + 0.08);
  }
  return minVis;
}

/**
 * Whether a landmark can be trusted for measurement.
 *
 * Two ways it cannot: low reported confidence, or a position outside the
 * frame. The second matters for close-up framing, where MediaPipe still
 * reports hips and knees it has never seen — guesses that jump around
 * between frames and read as movement from a player who has not moved.
 */
export function isLandmarkUsable(lm, idx = null, minVis = runtimeConfig.minLandmarkVisibility) {
  if (!lm) return false;
  const reqVis = requiredVisibilityForIndex(idx, minVis);
  if ((lm.visibility ?? 1) < reqVis) return false;
  return isLandmarkInFrame(lm);
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
  if (isLandmarkUsable(ls, 11) && isLandmarkUsable(rs, 12)) {
    const dist = pointDistance(ls, rs);
    if (dist >= 0.05) scale = dist / REFERENCE_SHOULDER_WIDTH;
  }

  if (scale === null) {
    const le = landmarks[7];
    const re = landmarks[8];
    if (isLandmarkUsable(le, 7) && isLandmarkUsable(re, 8)) {
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

    if (!isLandmarkUsable(curr, idx) || !isLandmarkUsable(prev, idx)) continue;

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
    if (!isLandmarkUsable(lm, idx)) continue;
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
    if (!isLandmarkUsable(curr, idx) || !isLandmarkUsable(prev, idx)) continue;

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
export function analyzeMovement(current, previous, excluded = null, customWeights = null) {
  if (!current || !previous || current.length === 0 || previous.length === 0) {
    return { score: 0, activeZone: null, zoneScores: {} };
  }

  const weights = customWeights || runtimeConfig.zoneWeights || ZONE_WEIGHTS;
  const scale = calculateBodyScale(current);

  // A zone out of frame scores 0 rather than contributing the noise of
  // landmarks MediaPipe is guessing at.

  // 1. Head movement
  const headData = calculateZoneDisplacement(current, previous, HEAD_LANDMARK_INDICES, scale, excluded);
  const headScore = hasZoneCoverage(headData.validCount, HEAD_LANDMARK_INDICES)
    ? headData.displacement * (weights.head ?? ZONE_WEIGHTS.head)
    : 0;

  // 2. Torso landmark displacement & Torso Centroid translation
  const torsoData = calculateZoneDisplacement(current, previous, TORSO_LANDMARK_INDICES, scale, excluded);
  const centroidDist = calculateGroupTranslation(current, previous, TORSO_LANDMARK_INDICES, scale, excluded);
  const torsoWeight = weights.torso ?? ZONE_WEIGHTS.torso;
  const torsoScore = hasZoneCoverage(torsoData.validCount, TORSO_LANDMARK_INDICES)
    ? Math.max(torsoData.displacement, centroidDist) * torsoWeight
    : 0;

  // 3. Arms movement
  const armsData = calculateZoneDisplacement(current, previous, ARMS_LANDMARK_INDICES, scale, excluded);
  const armsScore = hasZoneCoverage(armsData.validCount, ARMS_LANDMARK_INDICES)
    ? armsData.displacement * (weights.arms ?? ZONE_WEIGHTS.arms)
    : 0;

  // 4. Legs movement
  const legsData = calculateZoneDisplacement(current, previous, LEGS_LANDMARK_INDICES, scale, excluded);
  const legsScore = hasZoneCoverage(legsData.validCount, LEGS_LANDMARK_INDICES)
    ? legsData.displacement * (weights.legs ?? ZONE_WEIGHTS.legs)
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
      centroid: centroidDist * torsoWeight,
      arms: armsScore,
      legs: legsScore,
    },
  };
}

/**
 * Calculate static drift from the anchor (initial freeze pose).
 * Detects slow drift/creeping movements that frame-by-frame diffs might miss.
 */
export function calculateAnchorDrift(current, anchor, excluded = null, customWeights = null) {
  if (!current || !anchor) return { drift: 0, reason: null };

  const weights = customWeights || runtimeConfig.zoneWeights || ZONE_WEIGHTS;
  const scale = calculateBodyScale(current);

  // Head drift from start
  const headData = calculateZoneDisplacement(current, anchor, HEAD_LANDMARK_INDICES, scale, excluded);
  const headDrift = hasZoneCoverage(headData.validCount, HEAD_LANDMARK_INDICES)
    ? headData.displacement * (weights.head ?? ZONE_WEIGHTS.head)
    : 0;

  // Body/Torso centroid drift from start
  const torsoData = calculateZoneDisplacement(current, anchor, TORSO_LANDMARK_INDICES, scale, excluded);
  const centroidDrift = hasZoneCoverage(torsoData.validCount, TORSO_LANDMARK_INDICES)
    ? calculateGroupTranslation(current, anchor, TORSO_LANDMARK_INDICES, scale, excluded) * (weights.torso ?? ZONE_WEIGHTS.torso)
    : 0;

  // Arms drift from start
  const armsData = calculateZoneDisplacement(current, anchor, ARMS_LANDMARK_INDICES, scale, excluded);
  const armsDrift = hasZoneCoverage(armsData.validCount, ARMS_LANDMARK_INDICES)
    ? armsData.displacement * (weights.arms ?? ZONE_WEIGHTS.arms)
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
 * Adaptive exponential smoothing of a landmark set with occlusion protection.
 *
 * Key improvements for expo stability under partial occlusion:
 *  1. When a landmark drops below `minLandmarkVisibility` or goes out of frame,
 *     its position is FROZEN at the last known reliable coordinate instead of
 *     being dragged toward MediaPipe's hallucinated position.
 *  2. Confidence-weighted EMA: semi-occluded keypoints (visibility near the
 *     threshold) update with much lower alpha than high-confidence keypoints.
 *  3. Occlusion spike clamping: sudden single-frame jumps on moderate-confidence
 *     landmarks are clamped so occluded limbs do not snap across the screen.
 */
export function smoothLandmarks(raw, previous, options = {}) {
  if (!raw) return null;
  if (!previous) return raw.map((lm) => (lm ? { ...lm } : lm));

  const smoothness = clamp(options.poseSmoothing ?? runtimeConfig.poseSmoothing, 0, 0.95);
  const occlusionDamping = options.occlusionDamping ?? runtimeConfig.occlusionDamping;
  const minVisBase = options.minLandmarkVisibility ?? runtimeConfig.minLandmarkVisibility;

  // Map smoothness (0..0.95) to adaptive EMA parameters
  const minAlpha = smoothness <= 0 ? 1 : Math.max(0.03, (1 - smoothness) * 0.45);
  const gain = smoothness <= 0 ? 100 : Math.max(1.2, (1 - smoothness) * 28);
  const maxAlpha = smoothness <= 0 ? 1 : Math.max(minAlpha + 0.05, 1 - smoothness * 0.42);

  return raw.map((lm, i) => {
    const prev = previous[i];
    if (!lm) return prev ?? lm;
    if (!prev) return { ...lm };

    const minVis = requiredVisibilityForIndex(i, minVisBase);
    const inFrame = isLandmarkInFrame(lm);
    const rawVisibility = inFrame ? (lm.visibility ?? 1) : 0;

    // Low confidence / occluded: hold the last known reliable position and
    // decay visibility. Never pull `prev` toward an occluded/invented point!
    if (rawVisibility < minVis) {
      if (occlusionDamping) {
        return {
          ...prev,
          x: prev.x,
          y: prev.y,
          visibility: prev.visibility + (rawVisibility - prev.visibility) * VISIBILITY_DECAY_ALPHA,
        };
      }
      return {
        ...prev,
        x: prev.x + (lm.x - prev.x) * (VISIBILITY_DECAY_ALPHA * 0.25),
        y: prev.y + (lm.y - prev.y) * (VISIBILITY_DECAY_ALPHA * 0.25),
        visibility: prev.visibility + (rawVisibility - prev.visibility) * VISIBILITY_DECAY_ALPHA,
      };
    }

    let targetX = lm.x;
    let targetY = lm.y;
    const delta = pointDistance(prev, lm);

    // Confidence weight: 0.20 right at the visibility threshold, 1.0 when >= 0.85
    const confSpan = Math.max(0.1, 0.85 - minVis);
    const confWeight = occlusionDamping
      ? clamp((rawVisibility - minVis) / confSpan, 0.20, 1.0)
      : 1.0;

    // Clamp sudden large jumps when confidence is not rock-solid
    if (occlusionDamping && rawVisibility < 0.82) {
      const maxStep = 0.045 + 0.09 * confWeight;
      if (delta > maxStep) {
        const ratio = maxStep / delta;
        targetX = prev.x + (lm.x - prev.x) * ratio;
        targetY = prev.y + (lm.y - prev.y) * ratio;
      }
    }

    const effectiveDelta = Math.hypot(targetX - prev.x, targetY - prev.y);
    const baseAlpha = Math.min(maxAlpha, minAlpha + effectiveDelta * gain);
    const alpha = clamp(baseAlpha * confWeight, minAlpha * 0.5, maxAlpha);

    return {
      ...lm,
      x: prev.x + (targetX - prev.x) * alpha,
      y: prev.y + (targetY - prev.y) * alpha,
      visibility: prev.visibility + (rawVisibility - prev.visibility) * Math.max(0.35, alpha),
    };
  });
}

/**
 * Stateful PoseSmoother for the live skeleton & pose stream.
 *
 * Adds temporal hysteresis (`occlusionHoldMs`) and multi-frame spike rejection
 * on top of `smoothLandmarks`, so that when a limb is briefly occluded at the
 * expo (crossed arms, podium, passer-by):
 *  - Its keypoints hold steady at their last good position during `occlusionHoldMs`
 *    instead of flying off-screen or flickering on and off.
 *  - Single-frame hallucination teleports are rejected unless the new position
 *    is confirmed across consecutive frames.
 */
export class PoseSmoother {
  constructor() {
    this.reset();
  }

  reset() {
    this._smoothed = null;
    this._lastGoodAt = new Array(33).fill(0);
    this._spikeCounts = new Array(33).fill(0);
  }

  update(rawLandmarks, now = performance.now()) {
    if (!rawLandmarks || rawLandmarks.length === 0) {
      this._smoothed = null;
      return null;
    }

    const smoothness = clamp(runtimeConfig.poseSmoothing, 0, 0.95);
    const occlusionDamping = runtimeConfig.occlusionDamping;
    const holdMs = runtimeConfig.occlusionHoldMs;
    const minVisBase = runtimeConfig.minLandmarkVisibility;

    if (!this._smoothed) {
      this._smoothed = rawLandmarks.map((lm, i) => {
        if (!lm) return null;
        const vis = isLandmarkInFrame(lm) ? (lm.visibility ?? 1) : 0;
        if (vis >= requiredVisibilityForIndex(i, minVisBase)) {
          this._lastGoodAt[i] = now;
        }
        return { ...lm, visibility: vis };
      });
      return this._smoothed;
    }

    const minAlpha = smoothness <= 0 ? 1 : Math.max(0.03, (1 - smoothness) * 0.42);
    const gain = smoothness <= 0 ? 100 : Math.max(1.2, (1 - smoothness) * 26);
    const maxAlpha = smoothness <= 0 ? 1 : Math.max(minAlpha + 0.05, 1 - smoothness * 0.40);

    const next = rawLandmarks.map((lm, i) => {
      const prev = this._smoothed[i];
      if (!lm) return prev ?? null;
      if (!prev) {
        this._lastGoodAt[i] = now;
        return { ...lm };
      }

      const minVis = requiredVisibilityForIndex(i, minVisBase);
      const inFrame = isLandmarkInFrame(lm);
      const rawVis = inFrame ? (lm.visibility ?? 1) : 0;

      // 1. Landmark is below visibility gate (occluded or out of frame)
      if (rawVis < minVis) {
        this._spikeCounts[i] = 0;
        const elapsedSinceGood = now - (this._lastGoodAt[i] || 0);

        if (occlusionDamping && elapsedSinceGood <= holdMs && prev.visibility >= minVis) {
          // Hold last reliable position and keep visibility gently tapering
          // just above minVis during the hold window so brief occlusions don't blink.
          const holdProgress = holdMs > 0 ? clamp(elapsedSinceGood / holdMs, 0, 1) : 1;
          const heldVis = minVis + (prev.visibility - minVis) * (1 - holdProgress * 0.65);
          return {
            ...prev,
            x: prev.x,
            y: prev.y,
            visibility: heldVis,
          };
        }

        // Past the hold window: freeze coordinates and decay visibility below minVis
        return {
          ...prev,
          x: prev.x,
          y: prev.y,
          visibility: prev.visibility + (rawVis - prev.visibility) * VISIBILITY_DECAY_ALPHA,
        };
      }

      // 2. Landmark is above visibility gate
      this._lastGoodAt[i] = now;
      const delta = pointDistance(prev, lm);
      const confSpan = Math.max(0.1, 0.85 - minVis);
      const confWeight = occlusionDamping
        ? clamp((rawVis - minVis) / confSpan, 0.18, 1.0)
        : 1.0;

      let targetX = lm.x;
      let targetY = lm.y;

      // Multi-frame outlier / teleport rejection
      if (occlusionDamping) {
        const spikeThreshold = 0.055 + 0.085 * confWeight;
        if (delta > spikeThreshold) {
          this._spikeCounts[i] = (this._spikeCounts[i] || 0) + 1;
          // Damp the first 2 frames of a sudden jump heavily; if it persists
          // for 3+ frames, let it catch up progressively.
          const spikeAllow = this._spikeCounts[i] <= 2 ? 0.22 * confWeight : 0.65;
          const maxStep = spikeThreshold * spikeAllow;
          const ratio = Math.min(1, maxStep / delta);
          targetX = prev.x + (lm.x - prev.x) * ratio;
          targetY = prev.y + (lm.y - prev.y) * ratio;
        } else {
          this._spikeCounts[i] = 0;
        }
      }

      const effectiveDelta = Math.hypot(targetX - prev.x, targetY - prev.y);
      const baseAlpha = Math.min(maxAlpha, minAlpha + effectiveDelta * gain);
      const alpha = clamp(baseAlpha * confWeight, minAlpha * 0.4, maxAlpha);

      return {
        ...lm,
        x: prev.x + (targetX - prev.x) * alpha,
        y: prev.y + (targetY - prev.y) * alpha,
        visibility: prev.visibility + (rawVis - prev.visibility) * Math.max(0.3, alpha),
      };
    });

    this._smoothed = next;
    return next;
  }
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
        if (!isLandmarkUsable(curr, idx) || !isLandmarkUsable(prev, idx)) continue;

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

  const visible = landmarks.filter((lm, idx) => isLandmarkUsable(lm, idx));
  if (visible.length < 3) return null;

  const xs = visible.map((lm) => lm.x * canvasW);
  const ys = visible.map((lm) => lm.y * canvasH);

  const minX = Math.max(0, Math.min(...xs) - padding);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxX = Math.min(canvasW, Math.max(...xs) + padding);
  const maxY = Math.min(canvasH, Math.max(...ys) + padding);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Core skeleton topology (without noisy finger/toe sub-triangles)
const CORE_SKELETON_CONNECTIONS = [
  // Face
  [0, 1], [1, 2], [2, 3], [3, 7],   // nose → left eye → left ear
  [0, 4], [4, 5], [5, 6], [6, 8],   // nose → right eye → right ear
  [9, 10],                          // mouth
  // Torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // Arms
  [11, 13], [13, 15], [12, 14], [14, 16],
  // Legs
  [23, 25], [25, 27], [24, 26], [26, 28],
];

// Distal hand & foot connections (only drawn when hideNoisyExtremities is false)
const DISTAL_SKELETON_CONNECTIONS = [
  // Hands
  [15, 17], [15, 19], [15, 21], [17, 19],
  [16, 18], [16, 20], [16, 22], [18, 20],
  // Feet
  [27, 29], [29, 31], [27, 31],
  [28, 30], [30, 32], [28, 32],
];

const FULL_SKELETON_CONNECTIONS = [
  ...CORE_SKELETON_CONNECTIONS,
  ...DISTAL_SKELETON_CONNECTIONS,
];

// Larger dots for the anchor joints, smaller for face/hand/foot detail.
const MAJOR_KEYPOINTS = new Set([0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]);

/**
 * Draw the pose skeleton on the canvas overlay.
 *
 * Includes:
 *  - Smooth alpha fade when a joint approaches the visibility threshold
 *  - Anatomical max-bone-length sanity guard so occluded joints never draw
 *    giant stretched lines across the screen
 *  - Optional filtering of noisy finger/toe sub-landmarks
 */
export function drawSkeleton(ctx, landmarks, W, H, color = '#5b9cf5') {
  if (!landmarks) return;

  const unit = Math.max(W, H) / 640;
  const minVisBase = runtimeConfig.minLandmarkVisibility;
  const hideDistal = runtimeConfig.hideNoisyExtremities;
  const connections = hideDistal ? CORE_SKELETON_CONNECTIONS : FULL_SKELETON_CONNECTIONS;
  const scale = calculateBodyScale(landmarks);
  // Maximum plausible bone length in normalized coordinates; skips stretched
  // hallucinated lines when one end of a limb was occluded.
  const maxBoneSpan = Math.min(0.68, Math.max(0.38, 0.36 * scale));

  const jointAlpha = (lm, idx) => {
    const reqVis = requiredVisibilityForIndex(idx, minVisBase);
    const vis = lm?.visibility ?? 1;
    if (vis < reqVis) return 0;
    return clamp((vis - reqVis + 0.04) / 0.18, 0.2, 1);
  };

  ctx.save();
  ctx.lineCap = 'round';

  // Bones — dark halo underneath, colored line on top.
  for (const pass of ['halo', 'line']) {
    ctx.lineWidth = (pass === 'halo' ? 6 : 3) * unit;
    ctx.strokeStyle = pass === 'halo' ? 'rgba(0, 0, 0, 0.45)' : color;
    const basePassAlpha = pass === 'halo' ? 1 : 0.9;

    for (const [a, b] of connections) {
      const lmA = landmarks[a];
      const lmB = landmarks[b];
      if (!isLandmarkUsable(lmA, a, minVisBase) || !isLandmarkUsable(lmB, b, minVisBase)) continue;
      if (pointDistance(lmA, lmB) > maxBoneSpan) continue;

      const boneVisAlpha = Math.min(jointAlpha(lmA, a), jointAlpha(lmB, b));
      if (boneVisAlpha <= 0) continue;

      ctx.globalAlpha = basePassAlpha * boneVisAlpha;
      ctx.beginPath();
      ctx.moveTo(lmA.x * W, lmA.y * H);
      ctx.lineTo(lmB.x * W, lmB.y * H);
      ctx.stroke();
    }
  }

  // Keypoints
  ctx.lineWidth = 1.5 * unit;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillStyle = color;
  for (let idx = 0; idx < landmarks.length; idx++) {
    if (hideDistal && DISTAL_SET.has(idx)) continue;
    const lm = landmarks[idx];
    if (!isLandmarkUsable(lm, idx, minVisBase)) continue;

    const ptAlpha = jointAlpha(lm, idx);
    if (ptAlpha <= 0) continue;

    ctx.globalAlpha = ptAlpha;
    ctx.beginPath();
    ctx.arc(lm.x * W, lm.y * H, (MAJOR_KEYPOINTS.has(idx) ? 5 : 3.5) * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
