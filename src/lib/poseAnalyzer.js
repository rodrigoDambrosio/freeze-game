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
 * Calculate body scale factor based on shoulder distance.
 * Normalizes sensitivities whether the player is close or far from the webcam.
 * Reference shoulder distance = 0.22 (typical webcam torso view).
 */
export function calculateBodyScale(landmarks) {
  if (!landmarks) return 1.0;
  const ls = landmarks[11];
  const rs = landmarks[12];
  if (!ls || !rs || ls.visibility < MIN_LANDMARK_VISIBILITY || rs.visibility < MIN_LANDMARK_VISIBILITY) {
    return 1.0;
  }
  const dist = pointDistance(ls, rs);
  if (dist < 0.05) return 1.0;
  // Normalize scale: larger person -> larger scale factor -> divide displacement by scale
  const scale = dist / 0.22;
  return Math.max(0.6, Math.min(1.8, scale));
}

/**
 * Calculate average displacement and max displacement for a specific anatomical zone.
 */
export function calculateZoneDisplacement(current, previous, indices, scale = 1.0) {
  if (!current || !previous) return { displacement: 0, maxDisplacement: 0, validCount: 0 };

  let totalDist = 0;
  let maxDist = 0;
  let validCount = 0;

  for (const idx of indices) {
    const curr = current[idx];
    const prev = previous[idx];
    if (!curr || !prev) continue;

    if (curr.visibility < MIN_LANDMARK_VISIBILITY || prev.visibility < MIN_LANDMARK_VISIBILITY) {
      continue;
    }

    const dist = pointDistance(curr, prev) / scale;
    totalDist += dist;
    if (dist > maxDist) maxDist = dist;
    validCount++;
  }

  if (validCount === 0) return { displacement: 0, maxDisplacement: 0, validCount: 0 };
  return {
    displacement: totalDist / validCount,
    maxDisplacement: maxDist,
    validCount,
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
    if (!lm || lm.visibility < MIN_LANDMARK_VISIBILITY) continue;
    sumX += lm.x;
    sumY += lm.y;
    count++;
  }

  if (count === 0) return null;
  return { x: sumX / count, y: sumY / count };
}

/**
 * Multi-zone movement analysis between two frames.
 * Returns the peak weighted movement score and the identifying infraction zone.
 */
export function analyzeMovement(current, previous) {
  if (!current || !previous || current.length === 0 || previous.length === 0) {
    return { score: 0, activeZone: null, zoneScores: {} };
  }

  const scale = calculateBodyScale(current);

  // 1. Head movement
  const headData = calculateZoneDisplacement(current, previous, HEAD_LANDMARK_INDICES, scale);
  const headScore = headData.displacement * ZONE_WEIGHTS.head;

  // 2. Torso landmark displacement & Torso Centroid translation
  const torsoData = calculateZoneDisplacement(current, previous, TORSO_LANDMARK_INDICES, scale);
  const currCentroid = calculateCentroid(current, TORSO_LANDMARK_INDICES);
  const prevCentroid = calculateCentroid(previous, TORSO_LANDMARK_INDICES);
  let centroidDist = 0;
  if (currCentroid && prevCentroid) {
    centroidDist = (pointDistance(currCentroid, prevCentroid) / scale);
  }
  const torsoScore = Math.max(torsoData.displacement, centroidDist) * ZONE_WEIGHTS.torso;

  // 3. Arms movement
  const armsData = calculateZoneDisplacement(current, previous, ARMS_LANDMARK_INDICES, scale);
  const armsScore = armsData.displacement * ZONE_WEIGHTS.arms;

  // 4. Legs movement
  const legsData = calculateZoneDisplacement(current, previous, LEGS_LANDMARK_INDICES, scale);
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
export function calculateAnchorDrift(current, anchor) {
  if (!current || !anchor) return { drift: 0, reason: null };

  const scale = calculateBodyScale(current);

  // Head drift from start
  const headData = calculateZoneDisplacement(current, anchor, HEAD_LANDMARK_INDICES, scale);
  const headDrift = headData.displacement * ZONE_WEIGHTS.head;

  // Body/Torso centroid drift from start
  const currCentroid = calculateCentroid(current, TORSO_LANDMARK_INDICES);
  const anchorCentroid = calculateCentroid(anchor, TORSO_LANDMARK_INDICES);
  let centroidDrift = 0;
  if (currCentroid && anchorCentroid) {
    centroidDrift = (pointDistance(currCentroid, anchorCentroid) / scale) * ZONE_WEIGHTS.torso;
  }

  // Arms drift from start
  const armsData = calculateZoneDisplacement(current, anchor, ARMS_LANDMARK_INDICES, scale);
  const armsDrift = armsData.displacement * ZONE_WEIGHTS.arms;

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
 * MovementAnalyzer
 *
 * Stateful class that maintains a temporal sliding window buffer of landmarks
 * and compares against an anchor freeze pose.
 */
export class MovementAnalyzer {
  constructor(windowFrames = MOVEMENT_WINDOW_FRAMES) {
    this._windowFrames = windowFrames;
    this._history = [];
    this._anchorLandmarks = null;
    this._recentScores = [];
  }

  /**
   * Set the initial freeze pose when the game starts.
   */
  setAnchor(landmarks) {
    this._anchorLandmarks = landmarks ? JSON.parse(JSON.stringify(landmarks)) : null;
  }

  /**
   * Feed new frame landmarks and calculate composite movement.
   */
  update(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      return { score: 0, anchorDrift: 0, isValid: false, reason: null };
    }

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

    const windowAnalysis = analyzeMovement(landmarks, referenceFrame);
    const immediateAnalysis = analyzeMovement(landmarks, immediatePrevFrame);

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
      const driftResult = calculateAnchorDrift(landmarks, this._anchorLandmarks);
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

  reset() {
    this._history = [];
    this._recentScores = [];
    this._anchorLandmarks = null;
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

  const visible = landmarks.filter((lm) => lm && lm.visibility > 0.35);
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
    if (!lmA || !lmB) continue;
    if (lmA.visibility < 0.35 || lmB.visibility < 0.35) continue;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(lmA.x * W, lmA.y * H);
    ctx.lineTo(lmB.x * W, lmB.y * H);
    ctx.stroke();
  }

  // Draw keypoint dots
  for (const idx of TRACKED_LANDMARK_INDICES) {
    const lm = landmarks[idx];
    if (!lm || lm.visibility < 0.35) continue;
    ctx.beginPath();
    ctx.fillStyle = color;
    // Slightly larger dots for head (0, 7, 8) and core (11, 12)
    const isMajor = [0, 7, 8, 11, 12, 23, 24].includes(idx);
    ctx.arc(lm.x * W, lm.y * H, isMajor ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
