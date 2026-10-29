/**
 * simonPoseClassifiers.js
 *
 * Pure pose classifiers for the "Simón Dice" game mode: each one answers
 * "is this absolute posture being held right now?" rather than "did
 * something move?" — big, unambiguous shapes instead of the sub-millimetre
 * deviations the freeze game watches for, which is what makes this mode
 * tolerant of distance, lighting and background motion at a stand.
 *
 * All distances are normalized by calculateBodyScale, the same scale-
 * invariant unit the movement detector uses, so a margin reads the same
 * whether the player is close to the camera or a couple of metres back.
 */
import {
  isLandmarkUsable,
  calculateBodyScale,
  calculateCentroid,
  pointDistance,
} from './poseAnalyzer.js';
import {
  SIMON_ARMS_UP_MARGIN,
  SIMON_ARMS_DOWN_MARGIN,
  SIMON_TOUCH_MARGIN,
} from './constants.js';

const simonRuntimeMargins = {
  armsUpMargin: SIMON_ARMS_UP_MARGIN,
  armsDownMargin: SIMON_ARMS_DOWN_MARGIN,
  touchMargin: SIMON_TOUCH_MARGIN,
};

/**
 * Update Simon Says pose classification margins live from Admin settings.
 */
export function setSimonPoseMargins(patch = {}) {
  if (Number.isFinite(patch.armsUpMargin)) {
    simonRuntimeMargins.armsUpMargin = patch.armsUpMargin;
  }
  if (Number.isFinite(patch.armsDownMargin)) {
    simonRuntimeMargins.armsDownMargin = patch.armsDownMargin;
  }
  if (Number.isFinite(patch.touchMargin)) {
    simonRuntimeMargins.touchMargin = patch.touchMargin;
  }
}

// MediaPipe Pose landmark indices used below.
const NOSE = 0;
const L_EAR = 7;
const R_EAR = 8;
const HEAD_RING = [1, 4, 7, 8]; // eye-inner x2, ears — head without the nose
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

function isPointUsable(landmarks, idx) {
  return isLandmarkUsable(landmarks?.[idx], idx);
}

/** Both wrists raised well above the shoulders. */
export function isArmsUp(landmarks) {
  if (!landmarks) return false;
  if (![L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST].every((i) => isPointUsable(landmarks, i))) {
    return false;
  }
  const ls = landmarks[L_SHOULDER];
  const rs = landmarks[R_SHOULDER];
  const lw = landmarks[L_WRIST];
  const rw = landmarks[R_WRIST];

  const scale = calculateBodyScale(landmarks);
  const margin = simonRuntimeMargins.armsUpMargin;
  const leftRaised = (ls.y - lw.y) / scale > margin;
  const rightRaised = (rs.y - rw.y) / scale > margin;
  return leftRaised && rightRaised;
}

/** Exactly one wrist raised above its shoulder while the other stays down. */
export function isOneArmUp(landmarks) {
  if (!landmarks) return false;
  if (![L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST].every((i) => isPointUsable(landmarks, i))) {
    return false;
  }
  const ls = landmarks[L_SHOULDER];
  const rs = landmarks[R_SHOULDER];
  const lw = landmarks[L_WRIST];
  const rw = landmarks[R_WRIST];

  const scale = calculateBodyScale(landmarks);
  const margin = simonRuntimeMargins.armsUpMargin;
  const leftRaised = (ls.y - lw.y) / scale > margin;
  const rightRaised = (rs.y - rw.y) / scale > margin;
  const leftBelow = (lw.y - ls.y) / scale > 0.04;
  const rightBelow = (rw.y - rs.y) / scale > 0.04;

  return (leftRaised && rightBelow) || (rightRaised && leftBelow);
}

/** Both arms hanging down, wrists at or below hip height. */
export function isArmsDown(landmarks) {
  if (!landmarks) return false;
  if (![L_HIP, R_HIP, L_WRIST, R_WRIST].every((i) => isPointUsable(landmarks, i))) {
    return false;
  }
  const lh = landmarks[L_HIP];
  const rh = landmarks[R_HIP];
  const lw = landmarks[L_WRIST];
  const rw = landmarks[R_WRIST];

  const scale = calculateBodyScale(landmarks);
  const margin = simonRuntimeMargins.armsDownMargin;
  const leftDown = (lw.y - lh.y) / scale > -margin;
  const rightDown = (rw.y - rh.y) / scale > -margin;
  return leftDown && rightDown;
}

/** Either wrist close enough to the nose to count as touching it. */
export function isTouchingNose(landmarks) {
  if (!landmarks) return false;
  if (!isPointUsable(landmarks, NOSE)) return false;
  const nose = landmarks[NOSE];

  const scale = calculateBodyScale(landmarks);
  const lw = landmarks[L_WRIST];
  const rw = landmarks[R_WRIST];
  const leftDist = isPointUsable(landmarks, L_WRIST) ? pointDistance(lw, nose) / scale : Infinity;
  const rightDist = isPointUsable(landmarks, R_WRIST) ? pointDistance(rw, nose) / scale : Infinity;
  return Math.min(leftDist, rightDist) < simonRuntimeMargins.touchMargin;
}

/** Either wrist close enough to the head (eyes/ears, excluding the nose). */
export function isTouchingHead(landmarks) {
  if (!landmarks) return false;
  const headCentroid = calculateCentroid(landmarks, HEAD_RING);
  if (!headCentroid) return false;

  const scale = calculateBodyScale(landmarks);
  const lw = landmarks[L_WRIST];
  const rw = landmarks[R_WRIST];
  const leftDist = isPointUsable(landmarks, L_WRIST) ? pointDistance(lw, headCentroid) / scale : Infinity;
  const rightDist = isPointUsable(landmarks, R_WRIST) ? pointDistance(rw, headCentroid) / scale : Infinity;
  return Math.min(leftDist, rightDist) < simonRuntimeMargins.touchMargin;
}

/** Head clearly tilted to either side (ears uneven vertically relative to ear span). */
export function isHeadTilted(landmarks) {
  if (!landmarks) return false;
  if (!isPointUsable(landmarks, L_EAR) || !isPointUsable(landmarks, R_EAR)) return false;
  const le = landmarks[L_EAR];
  const re = landmarks[R_EAR];
  const earSpan = pointDistance(le, re);
  if (earSpan < 0.025) return false;
  const verticalTiltRatio = Math.abs(le.y - re.y) / earSpan;
  return verticalTiltRatio > 0.28;
}

/** Arms crossed over the chest (disabled by default in #admin, optional). */
export function isArmsCrossed(landmarks) {
  if (!landmarks) return false;
  if (![L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST, L_HIP, R_HIP].every((i) => isPointUsable(landmarks, i))) {
    return false;
  }
  const ls = landmarks[L_SHOULDER];
  const rs = landmarks[R_SHOULDER];
  const lw = landmarks[L_WRIST];
  const rw = landmarks[R_WRIST];
  const lh = landmarks[L_HIP];
  const rh = landmarks[R_HIP];

  const leftCrossed = pointDistance(lw, rs) < pointDistance(lw, ls);
  const rightCrossed = pointDistance(rw, ls) < pointDistance(rw, rs);

  const chestTop = Math.min(ls.y, rs.y);
  const chestBottom = Math.max(lh.y, rh.y);
  const atChestHeight =
    lw.y > chestTop && lw.y < chestBottom && rw.y > chestTop && rw.y < chestBottom;

  return leftCrossed && rightCrossed && atChestHeight;
}
