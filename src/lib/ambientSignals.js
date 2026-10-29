/**
 * ambientSignals.js
 *
 * What the idle/attract screen observes about people walking past the stand,
 * plus shared facial/gesture classifiers used by both "Simón Dice" and the
 * live passer-by tag (`PersonTag`).
 *
 * Ambient observations only trigger when confidence / score > 65% (0.65)
 * and when the signal is enabled in #admin.
 */
import {
  isArmsUp,
  isOneArmUp,
  isTouchingNose,
  isTouchingHead,
  isHeadTilted,
  isArmsCrossed,
} from './simonPoseClassifiers.js';
import { isLandmarkUsable, calculateBodyScale } from './poseAnalyzer.js';
import {
  AMBIENT_SMILE_THRESHOLD,
  AMBIENT_MOUTH_OPEN_THRESHOLD,
  AMBIENT_EYEBROWS_UP_THRESHOLD,
  AMBIENT_WINK_CLOSED_THRESHOLD,
  AMBIENT_WINK_OPEN_THRESHOLD,
  AMBIENT_WAVE_MIN_SWING,
  AMBIENT_WAVE_MIN_REVERSALS,
  AMBIENT_WAVE_WINDOW_MS,
  BLINK_THRESHOLD,
} from './constants.js';

export const AMBIENT_MIN_CONFIDENCE = 0.65;

const NOSE = 0;
const L_EAR = 7;
const R_EAR = 8;
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_WRIST = 15;
const R_WRIST = 16;
const L_HIP = 23;
const R_HIP = 24;

function poseConfidence(landmarks, indices) {
  if (!landmarks) return 0;
  let sum = 0;
  let count = 0;
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!lm) continue;
    const vis = lm.visibility ?? 1;
    sum += vis;
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

function hasHighConfidence(landmarks, indices, minConf = AMBIENT_MIN_CONFIDENCE) {
  if (!landmarks) return false;
  return indices.every((idx) => (landmarks[idx]?.visibility ?? 0) > minConf);
}

function createWristSwingTracker() {
  let anchor = null;
  let dir = 0;
  let peak = 0;
  let reversals = [];

  return function update(x, now) {
    if (x == null) {
      anchor = null;
      dir = 0;
      reversals = [];
      return 0;
    }
    reversals = reversals.filter((t) => now - t <= AMBIENT_WAVE_WINDOW_MS);

    if (anchor === null) {
      anchor = x;
    } else if (dir === 0) {
      if (Math.abs(x - anchor) >= AMBIENT_WAVE_MIN_SWING) {
        dir = Math.sign(x - anchor);
        peak = x;
      }
    } else if ((x - peak) * dir > 0) {
      peak = x;
    } else if ((peak - x) * dir >= AMBIENT_WAVE_MIN_SWING) {
      reversals.push(now);
      dir = -dir;
      peak = x;
    }
    return reversals.length;
  };
}

const leftWrist = createWristSwingTracker();
const rightWrist = createWristSwingTracker();

function wristSample(landmarks, wristIdx, shoulderIdx, scale) {
  const wrist = landmarks[wristIdx];
  const shoulder = landmarks[shoulderIdx];
  if (!isLandmarkUsable(wrist, wristIdx) || !isLandmarkUsable(shoulder, shoulderIdx)) return null;
  if (wrist.y >= shoulder.y) return null;
  return wrist.x / scale;
}

/** A hand raised above the shoulder and swung side to side (optional in #admin). */
export function isWaving(landmarks) {
  const now = performance.now();
  const scale = landmarks ? calculateBodyScale(landmarks) : 1;
  const lx = landmarks ? wristSample(landmarks, L_WRIST, L_SHOULDER, scale) : null;
  const rx = landmarks ? wristSample(landmarks, R_WRIST, R_SHOULDER, scale) : null;
  const best = Math.max(leftWrist(lx, now), rightWrist(rx, now));
  return best >= AMBIENT_WAVE_MIN_REVERSALS;
}

function toScoreMap(categories) {
  const map = new Map();
  if (!categories) return map;
  for (const c of categories) map.set(c.categoryName, c.score);
  return map;
}

/** Live smile intensity (0..1). */
export function smileScore(blendshapes) {
  const map = toScoreMap(blendshapes);
  return Math.max(map.get('mouthSmileLeft') ?? 0, map.get('mouthSmileRight') ?? 0);
}

/** Smile blendshapes crossing the threshold on either side of the mouth. */
export function isSmiling(blendshapes, minScore = AMBIENT_SMILE_THRESHOLD) {
  if (!blendshapes) return false;
  return smileScore(blendshapes) > minScore;
}

/** Live mouth-open intensity (0..1). */
export function mouthOpenScore(blendshapes) {
  const map = toScoreMap(blendshapes);
  return map.get('jawOpen') ?? 0;
}

/** Jaw clearly dropped open — a surprised/laughing "O" shape. */
export function isMouthOpen(blendshapes, minScore = AMBIENT_MOUTH_OPEN_THRESHOLD) {
  if (!blendshapes) return false;
  return mouthOpenScore(blendshapes) > minScore;
}

/** Live eyebrows-raised intensity (0..1). */
export function eyebrowsScore(blendshapes) {
  const map = toScoreMap(blendshapes);
  return Math.max(
    map.get('browInnerUp') ?? 0,
    map.get('browOuterUpLeft') ?? 0,
    map.get('browOuterUpRight') ?? 0,
  );
}

/** Eyebrows raised, as in surprise. */
export function isEyebrowsRaised(blendshapes, minScore = AMBIENT_EYEBROWS_UP_THRESHOLD) {
  if (!blendshapes) return false;
  return eyebrowsScore(blendshapes) > minScore;
}

/** Live wink score (0..1). */
export function winkScore(blendshapes) {
  const map = toScoreMap(blendshapes);
  const left = map.get('eyeBlinkLeft') ?? 0;
  const right = map.get('eyeBlinkRight') ?? 0;
  return Math.max(left, right);
}

/** One eye clearly closed while the other stays open (optional in #admin). */
export function isWinking(blendshapes) {
  if (!blendshapes) return false;
  const map = toScoreMap(blendshapes);
  const left = map.get('eyeBlinkLeft') ?? 0;
  const right = map.get('eyeBlinkRight') ?? 0;
  const closedEye = Math.max(left, right);
  const openEye = Math.min(left, right);
  return closedEye > AMBIENT_WINK_CLOSED_THRESHOLD && openEye < AMBIENT_WINK_OPEN_THRESHOLD;
}

/** Live closed-eyes score (0..1). */
export function eyesClosedScore(blendshapes) {
  const map = toScoreMap(blendshapes);
  const left = map.get('eyeBlinkLeft') ?? 0;
  const right = map.get('eyeBlinkRight') ?? 0;
  return Math.min(left, right);
}

/** Both eyes intentionally closed (or mid-blink). */
export function isEyesClosed(blendshapes, minScore = BLINK_THRESHOLD) {
  if (!blendshapes) return false;
  return eyesClosedScore(blendshapes) > minScore;
}

/** Live frown / nose-sneer intensity (0..1) from Freeze Game's faceAnalyzer. */
export function frownScore(blendshapes) {
  const map = toScoreMap(blendshapes);
  return Math.max(
    map.get('browDownLeft') ?? 0,
    map.get('browDownRight') ?? 0,
    map.get('noseSneerLeft') ?? 0,
    map.get('noseSneerRight') ?? 0,
  );
}

/** Eyebrows furrowed or nose sneered ("Fruncí el ceño"). */
export function isFrowning(blendshapes, minScore = 0.40) {
  if (!blendshapes) return false;
  return frownScore(blendshapes) > minScore;
}

/** Live mouth-pucker intensity (0..1) from Freeze Game's faceAnalyzer. */
export function puckerScore(blendshapes) {
  const map = toScoreMap(blendshapes);
  return map.get('mouthPucker') ?? 0;
}

/** Lips puckered forward ("Mandá un beso" / "Fruncí los labios"). */
export function isMouthPucker(blendshapes, minScore = 0.48) {
  if (!blendshapes) return false;
  return puckerScore(blendshapes) > minScore;
}

/**
 * Pose-based observations, fed from the pose landmarker's stream.
 * Only shown when landmark visibility / confidence > 65% (AMBIENT_MIN_CONFIDENCE).
 */
export const AMBIENT_POSE_SIGNALS = [
  {
    id: 'arms-up',
    label: 'brazos arriba',
    icon: '🙌',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (lms) => hasHighConfidence(lms, [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST]) && isArmsUp(lms),
    value: (lms) => poseConfidence(lms, [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST]),
  },
  {
    id: 'one-arm-up',
    label: 'mano levantada',
    icon: '🙋',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (lms) => hasHighConfidence(lms, [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST]) && isOneArmUp(lms),
    value: (lms) => poseConfidence(lms, [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST]),
  },
  {
    id: 'touch-nose',
    label: 'tocándose la nariz',
    icon: '👃',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (lms) => hasHighConfidence(lms, [NOSE]) && isTouchingNose(lms),
    value: (lms) => poseConfidence(lms, [NOSE, L_WRIST, R_WRIST]),
  },
  {
    id: 'touch-head',
    label: 'manos en la cabeza',
    icon: '🤚',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (lms) => hasHighConfidence(lms, [L_EAR, R_EAR]) && isTouchingHead(lms),
    value: (lms) => poseConfidence(lms, [L_EAR, R_EAR, L_WRIST, R_WRIST]),
  },
  {
    id: 'head-tilt',
    label: 'cabeza inclinada',
    icon: '🙆',
    defaultEnabled: true,
    confirmFrames: 3,
    classifier: (lms) => hasHighConfidence(lms, [L_EAR, R_EAR]) && isHeadTilted(lms),
    value: (lms) => poseConfidence(lms, [L_EAR, R_EAR]),
  },
  {
    id: 'wave',
    label: 'saludando',
    icon: '👋',
    defaultEnabled: false,
    confirmFrames: 1,
    classifier: (lms) => isWaving(lms),
    value: (lms) => poseConfidence(lms, [L_SHOULDER, R_SHOULDER]),
  },
  {
    id: 'arms-crossed',
    label: 'brazos cruzados',
    icon: '🙅',
    defaultEnabled: false,
    confirmFrames: 3,
    classifier: (lms) => hasHighConfidence(lms, [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST]) && isArmsCrossed(lms),
    value: (lms) => poseConfidence(lms, [L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST, L_HIP, R_HIP]),
  },
];

/**
 * Face-based observations, fed from the face landmarker's stream.
 * Only shown when confidence / score > 65% (AMBIENT_MIN_CONFIDENCE = 0.65).
 */
export const AMBIENT_FACE_SIGNALS = [
  {
    id: 'smile',
    label: 'sonriendo',
    icon: '😄',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (bs) => isSmiling(bs, AMBIENT_MIN_CONFIDENCE),
    value: smileScore,
  },
  {
    id: 'mouth-open',
    label: 'boca abierta',
    icon: '😮',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (bs) => isMouthOpen(bs, AMBIENT_MIN_CONFIDENCE),
    value: mouthOpenScore,
  },
  {
    id: 'eyebrows-up',
    label: 'cejas levantadas',
    icon: '🤨',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (bs) => isEyebrowsRaised(bs, AMBIENT_MIN_CONFIDENCE),
    value: eyebrowsScore,
  },
  {
    id: 'eyes-closed',
    label: 'ojos cerrados',
    icon: '😌',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (bs) => isEyesClosed(bs, AMBIENT_MIN_CONFIDENCE),
    value: eyesClosedScore,
  },
  {
    id: 'mouth-pucker',
    label: 'beso / labios fruncidos',
    icon: '😗',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (bs) => isMouthPucker(bs, AMBIENT_MIN_CONFIDENCE),
    value: puckerScore,
  },
  {
    id: 'frown',
    label: 'ceño fruncido',
    icon: '😠',
    defaultEnabled: true,
    confirmFrames: 2,
    classifier: (bs) => isFrowning(bs, AMBIENT_MIN_CONFIDENCE),
    value: frownScore,
  },
  {
    id: 'wink',
    label: 'guiñando un ojo',
    icon: '😉',
    defaultEnabled: false,
    confirmFrames: 2,
    classifier: (bs) => isWinking(bs) && winkScore(bs) > AMBIENT_MIN_CONFIDENCE,
    value: winkScore,
  },
];

/** Display order of the tag's lines. */
export const AMBIENT_SIGNALS = [...AMBIENT_POSE_SIGNALS, ...AMBIENT_FACE_SIGNALS];

export const DEFAULT_DISABLED_AMBIENT_SIGNALS = AMBIENT_SIGNALS
  .filter((s) => !s.defaultEnabled)
  .map((s) => s.id);

let disabledAmbientSignalIds = new Set(DEFAULT_DISABLED_AMBIENT_SIGNALS);
let ambientMotionEnabled = true;

export function setAmbientRuntimeConfig(patch = {}) {
  if (Array.isArray(patch.disabledSignals)) {
    disabledAmbientSignalIds = new Set(patch.disabledSignals);
  }
  if (typeof patch.showMotion === 'boolean') {
    ambientMotionEnabled = patch.showMotion;
  }
}

export function isAmbientSignalEnabled(id) {
  return !disabledAmbientSignalIds.has(id);
}

export function isAmbientMotionEnabled() {
  return ambientMotionEnabled;
}

/** Horizontal center of the body (shoulders, else hips), or null. */
export function bodyCenterX(landmarks) {
  if (!landmarks) return null;
  for (const [a, b] of [[L_SHOULDER, R_SHOULDER], [23, 24]]) {
    if (isLandmarkUsable(landmarks[a], a) && isLandmarkUsable(landmarks[b], b)) {
      return (landmarks[a].x + landmarks[b].x) / 2;
    }
  }
  return null;
}
