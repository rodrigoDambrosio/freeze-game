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
  REQUIRED_LANDMARK_INDICES,
  ANCHOR_MIN_VISIBILITY,
  LANDMARK_SMOOTHING,
  ARM_LANDMARK_SMOOTHING,
  CONFIDENCE_LOW_VISIBILITY,
  CONFIDENCE_HIGH_VISIBILITY,
  MOVEMENT_WINDOW_FRAMES,
} from './constants.js';

const ARMS_INDEX_SET = new Set(ARMS_LANDMARK_INDICES);

/**
 * Restrict a zone's landmark indices to the tracked ones (all of them when `tracked` is null).
 */
function trackedOnly(indices, tracked) {
  return tracked ? indices.filter((idx) => tracked.has(idx)) : indices;
}

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
 * Whether a landmark can be trusted for tracking: visible enough and inside the image.
 * Points outside the image (e.g. elbows or hips of a player seated close to the webcam)
 * are guesses by the model and jitter a lot from frame to frame.
 */
function isLandmarkUsable(lm) {
  return !!lm && lm.visibility >= MIN_LANDMARK_VISIBILITY &&
    lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1;
}

/**
 * How well the model can estimate a landmark, from 0 (a guess, or outside the image)
 * to 1 (clearly seen), ramping with visibility instead of a hard cutoff.
 */
export function landmarkConfidence(lm) {
  if (!lm || lm.x < 0 || lm.x > 1 || lm.y < 0 || lm.y > 1) return 0;
  const ramp = (lm.visibility - CONFIDENCE_LOW_VISIBILITY) / (CONFIDENCE_HIGH_VISIBILITY - CONFIDENCE_LOW_VISIBILITY);
  return Math.max(0, Math.min(1, ramp));
}

/**
 * Calculate body scale factor based on shoulder distance.
 * Normalizes sensitivities whether the player is close or far from the webcam.
 * Reference shoulder distance = 0.22 (typical webcam torso view).
 * Returns `fallback` when the shoulders can't be measured.
 */
export function calculateBodyScale(landmarks, fallback = 1.0) {
  if (!landmarks) return fallback;
  const ls = landmarks[11];
  const rs = landmarks[12];
  if (!isLandmarkUsable(ls) || !isLandmarkUsable(rs)) return fallback;
  const dist = pointDistance(ls, rs);
  if (dist < 0.05) return fallback;
  // Normalize scale: larger person -> larger scale factor -> divide displacement by scale
  // (upper bound fits a player seated close to a laptop webcam, shoulders ~0.5-0.65 wide)
  const scale = dist / 0.22;
  return Math.max(0.6, Math.min(3.0, scale));
}

/**
 * Calculate average displacement and max displacement for a specific anatomical zone.
 * Each point counts in proportion to how well the model sees it in both frames.
 */
export function calculateZoneDisplacement(current, previous, indices, scale = 1.0) {
  if (!current || !previous) return { displacement: 0, maxDisplacement: 0, validCount: 0 };

  let totalDist = 0;
  let totalWeight = 0;
  let maxDist = 0;
  let validCount = 0;

  for (const idx of indices) {
    const curr = current[idx];
    const prev = previous[idx];
    const weight = Math.min(landmarkConfidence(curr), landmarkConfidence(prev));
    if (weight === 0) continue;

    const dist = weight * pointDistance(curr, prev) / scale;
    totalDist += dist;
    totalWeight += weight;
    if (dist > maxDist) maxDist = dist;
    validCount++;
  }

  if (validCount === 0) return { displacement: 0, maxDisplacement: 0, validCount: 0 };
  return {
    displacement: totalDist / totalWeight,
    maxDisplacement: maxDist,
    validCount,
  };
}

/**
 * Calculate how far the centroid (center of mass) of specific landmarks (e.g. torso) moved.
 * Only landmarks visible in both frames are used, so a landmark flickering in or out of
 * visibility (e.g. hips at the frame edge) doesn't shift the centroid and fake a movement.
 */
export function calculateCentroidDisplacement(current, previous, indices, scale = 1.0) {
  if (!current || !previous) return 0;
  let sumDx = 0;
  let sumDy = 0;
  let totalWeight = 0;

  for (const idx of indices) {
    const curr = current[idx];
    const prev = previous[idx];
    const weight = Math.min(landmarkConfidence(curr), landmarkConfidence(prev));
    if (weight === 0) continue;
    sumDx += weight * (curr.x - prev.x);
    sumDy += weight * (curr.y - prev.y);
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.sqrt(sumDx * sumDx + sumDy * sumDy) / totalWeight / scale;
}

/**
 * Whether all the given landmarks are visible inside the image.
 */
function areLandmarksVisible(landmarks, indices) {
  if (!landmarks) return false;
  return indices.every((idx) => isLandmarkUsable(landmarks[idx]));
}

/**
 * Whether the player is framed well enough to play: both shoulders visible.
 * Hips aren't required, so a player seated in front of the webcam is detected too.
 */
export function isPlayerInFrame(landmarks) {
  return areLandmarksVisible(landmarks, REQUIRED_LANDMARK_INDICES);
}

/**
 * Multi-zone movement analysis between two frames.
 * Returns the peak weighted movement score and the identifying infraction zone.
 */
export function analyzeMovement(current, previous, scale = calculateBodyScale(current), tracked = null) {
  if (!current || !previous || current.length === 0 || previous.length === 0) {
    return { score: 0, activeZone: null, zoneScores: {} };
  }

  const head = trackedOnly(HEAD_LANDMARK_INDICES, tracked);
  const torso = trackedOnly(TORSO_LANDMARK_INDICES, tracked);
  const arms = trackedOnly(ARMS_LANDMARK_INDICES, tracked);
  const legs = trackedOnly(LEGS_LANDMARK_INDICES, tracked);

  // 1. Head movement
  const headData = calculateZoneDisplacement(current, previous, head, scale);
  const headScore = headData.displacement * ZONE_WEIGHTS.head;

  // 2. Torso landmark displacement & Torso Centroid translation
  const torsoData = calculateZoneDisplacement(current, previous, torso, scale);
  const centroidDist = calculateCentroidDisplacement(current, previous, torso, scale);
  const torsoScore = Math.max(torsoData.displacement, centroidDist) * ZONE_WEIGHTS.torso;

  // 3. Arms movement: the point that moved most, since averaging both elbows and wrists
  // would dilute one hand moving to a quarter of its displacement
  const armsData = calculateZoneDisplacement(current, previous, arms, scale);
  const armsScore = armsData.maxDisplacement * ZONE_WEIGHTS.arms;

  // 4. Legs movement
  const legsData = calculateZoneDisplacement(current, previous, legs, scale);
  const legsScore = legsData.displacement * ZONE_WEIGHTS.legs;

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
export function calculateAnchorDrift(current, anchor, scale = calculateBodyScale(current), tracked = null) {
  if (!current || !anchor) return { drift: 0, reason: null };

  // Head drift from start
  const headData = calculateZoneDisplacement(current, anchor, trackedOnly(HEAD_LANDMARK_INDICES, tracked), scale);
  const headDrift = headData.displacement * ZONE_WEIGHTS.head;

  // Body/Torso centroid drift from start
  const centroidDrift = calculateCentroidDisplacement(
    current, anchor, trackedOnly(TORSO_LANDMARK_INDICES, tracked), scale
  ) * ZONE_WEIGHTS.torso;

  // Arms drift from start (point that moved most, as in analyzeMovement)
  const armsData = calculateZoneDisplacement(current, anchor, trackedOnly(ARMS_LANDMARK_INDICES, tracked), scale);
  const armsDrift = armsData.maxDisplacement * ZONE_WEIGHTS.arms;

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
  };
}

/**
 * LandmarkSmoother
 *
 * Smooths landmark positions and visibility over time to filter out the model's per-frame
 * jitter (the Tasks API, unlike the legacy MediaPipe Pose solution, doesn't smooth them).
 * Positions follow each new reading in proportion to how well the model sees the point,
 * so a point it can't estimate holds its last reliable position instead of jumping around.
 * Arms get stronger smoothing: wrists and elbows are the model's noisiest points.
 */
export class LandmarkSmoother {
  constructor() {
    this._smoothed = null;
  }

  /**
   * Feed a new frame's landmarks (null when no person is detected, which restarts smoothing).
   */
  smooth(landmarks) {
    if (!landmarks) {
      this._smoothed = null;
      return null;
    }
    const prev = this._smoothed;
    this._smoothed = landmarks.map((lm, i) => {
      const p = prev && prev[i];
      if (!p || !lm) return lm;
      const k = ARMS_INDEX_SET.has(i) ? ARM_LANDMARK_SMOOTHING : LANDMARK_SMOOTHING;
      // Guessed points still drift slowly toward the model's estimate
      const kPosition = k * Math.max(landmarkConfidence(lm), 0.1);
      return {
        ...lm,
        x: p.x + kPosition * (lm.x - p.x),
        y: p.y + kPosition * (lm.y - p.y),
        visibility: p.visibility + k * (lm.visibility - p.visibility),
      };
    });
    return this._smoothed;
  }

  reset() {
    this._smoothed = null;
  }
}

/**
 * MovementAnalyzer
 *
 * Stateful class that maintains a temporal sliding window buffer of landmarks
 * and compares against an anchor freeze pose. Expects landmarks already smoothed
 * by a LandmarkSmoother.
 */
export class MovementAnalyzer {
  constructor(windowFrames = MOVEMENT_WINDOW_FRAMES) {
    this._windowFrames = windowFrames;
    this._history = [];
    this._anchorLandmarks = null;
    this._trackedIndices = null;
    this._requiredIndices = REQUIRED_LANDMARK_INDICES;
    this._recentScores = [];
    this._scale = 1.0;
  }

  /**
   * Set the initial freeze pose when the game starts.
   */
  setAnchor(pose) {
    this._anchorLandmarks = pose ? JSON.parse(JSON.stringify(pose)) : null;
    this._scale = calculateBodyScale(pose, this._scale);

    // Only body parts clearly visible in the freeze pose are judged during play, so
    // half-hidden ones (e.g. hands behind a desk) with guessed, jittery positions are
    // ignored. The shoulders are always judged. Torso parts among them must stay in view.
    if (!pose) {
      this._trackedIndices = null;
      this._requiredIndices = REQUIRED_LANDMARK_INDICES;
      return;
    }
    const clearlyVisible = TRACKED_LANDMARK_INDICES.filter(
      (idx) => isLandmarkUsable(pose[idx]) && pose[idx].visibility >= ANCHOR_MIN_VISIBILITY
    );
    this._trackedIndices = new Set([...REQUIRED_LANDMARK_INDICES, ...clearlyVisible]);
    this._requiredIndices = [...new Set([
      ...REQUIRED_LANDMARK_INDICES,
      ...clearlyVisible.filter((idx) => TORSO_LANDMARK_INDICES.includes(idx)),
    ])];
  }

  /**
   * Whether the torso landmarks required by the freeze pose are still visible.
   * Adapts to the framing: hips hidden at the start (seated player) aren't required,
   * hips visible at the start (standing player) must stay in view.
   */
  isTorsoInView(landmarks) {
    return areLandmarksVisible(landmarks, this._requiredIndices);
  }

  /**
   * Feed new frame landmarks and calculate composite movement.
   */
  update(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      return { score: 0, anchorDrift: 0, isValid: false, reason: null };
    }

    // Keep the last measured body scale when a shoulder briefly drops out of view
    this._scale = calculateBodyScale(landmarks, this._scale);

    this._history.push(landmarks);
    if (this._history.length > this._windowFrames) {
      this._history.shift();
    }

    if (this._history.length < 2) {
      return { score: 0, anchorDrift: 0, isValid: false, reason: null };
    }

    // Compare with the frame from (window - 1) frames ago (captures moderate velocities)
    const referenceFrame = this._history[0];
    const immediatePrevFrame = this._history[this._history.length - 2];

    const windowAnalysis = analyzeMovement(landmarks, referenceFrame, this._scale, this._trackedIndices);
    const immediateAnalysis = analyzeMovement(landmarks, immediatePrevFrame, this._scale, this._trackedIndices);

    // Dynamic movement score: peak of smoothed window displacement or sudden spike
    const rawScore = Math.max(windowAnalysis.score, immediateAnalysis.score);
    const reason = windowAnalysis.score >= immediateAnalysis.score ? windowAnalysis.reason : immediateAnalysis.reason;
    const activeZone = windowAnalysis.score >= immediateAnalysis.score ? windowAnalysis.activeZone : immediateAnalysis.activeZone;

    // Smooth dynamic score over 3 frames
    this._recentScores.push(rawScore);
    if (this._recentScores.length > 3) this._recentScores.shift();
    const smoothedScore = this._recentScores.reduce((a, b) => a + b, 0) / this._recentScores.length;

    // Calculate static drift against initial freeze anchor pose
    let anchorDrift = 0;
    let anchorReason = null;
    if (this._anchorLandmarks) {
      const driftResult = calculateAnchorDrift(landmarks, this._anchorLandmarks, this._scale, this._trackedIndices);
      anchorDrift = driftResult.drift;
      anchorReason = driftResult.reason;
    }

    return {
      score: smoothedScore,
      anchorDrift,
      isValid: this._history.length >= 2,
      reason,
      anchorReason,
      activeZone,
      zoneScores: windowAnalysis.zoneScores,
    };
  }

  /**
   * Reset the round state. The body scale is kept: it describes the player, not the round.
   */
  reset() {
    this._history = [];
    this._recentScores = [];
    this._anchorLandmarks = null;
    this._trackedIndices = null;
    this._requiredIndices = REQUIRED_LANDMARK_INDICES;
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

  const visible = landmarks.filter((lm) => landmarkConfidence(lm) > 0);
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

  // Draw bone lines, fading the ones the model can't see well
  for (const [a, b] of CONNECTIONS) {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    const confidence = Math.min(landmarkConfidence(lmA), landmarkConfidence(lmB));
    if (confidence === 0) continue;

    ctx.globalAlpha = 0.75 * confidence;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(lmA.x * W, lmA.y * H);
    ctx.lineTo(lmB.x * W, lmB.y * H);
    ctx.stroke();
  }

  // Draw keypoint dots
  for (const idx of TRACKED_LANDMARK_INDICES) {
    const lm = landmarks[idx];
    const confidence = landmarkConfidence(lm);
    if (confidence === 0) continue;
    ctx.globalAlpha = 0.75 * confidence;
    ctx.beginPath();
    ctx.fillStyle = color;
    // Slightly larger dots for head (0, 7, 8) and core (11, 12)
    const isMajor = [0, 7, 8, 11, 12, 23, 24].includes(idx);
    ctx.arc(lm.x * W, lm.y * H, isMajor ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
