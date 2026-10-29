/**
 * adminSync.js
 *
 * Cross-tab bridge between the player-facing game screen and the admin
 * config screen (opened as a separate tab/window so participants never see
 * settings being adjusted). Backed by localStorage + the native `storage`
 * event: it already fires only in *other* tabs on the same origin, which is
 * exactly the one-way-mirror behavior this needs, with no server involved.
 */
import {
  DEFAULT_FREEZE_SECONDS,
  DEFAULT_SENSITIVITY,
  MIN_FREEZE_SECONDS,
  MAX_FREEZE_SECONDS,
  SENSITIVITY_LEVELS,
  SIMON_PRESETS,
  DEFAULT_SIMON_PRESET,
  DEFAULT_STICKER_THRESHOLD,
  DEFAULT_PEN_THRESHOLD,
  MIN_REWARD_THRESHOLD,
  MAX_REWARD_THRESHOLD,
  DEFAULT_POSE_SMOOTHING,
  DEFAULT_OCCLUSION_DAMPING,
  DEFAULT_OCCLUSION_HOLD_MS,
  DEFAULT_HIDE_NOISY_EXTREMITIES,
  MIN_LANDMARK_VISIBILITY,
  MIN_POSE_CONFIDENCE,
  BREACH_CONFIRM_FRAMES,
  POSE_LOSS_GRACE_MS,
  ZONE_WEIGHTS,
  SIMON_POSE_CONFIRM_FRAMES,
  SIMON_ARMS_UP_MARGIN,
  SIMON_ARMS_DOWN_MARGIN,
  SIMON_TOUCH_MARGIN,
  VIDEO_SOURCE_TYPES,
  DEFAULT_VIDEO_SOURCE_TYPE,
  HTTP_STREAM_MODES,
  DEFAULT_HTTP_STREAM_MODE,
  INFERENCE_DELEGATES,
  DEFAULT_INFERENCE_DELEGATE,
  POSE_MODEL_VARIANTS,
  DEFAULT_POSE_MODEL_VARIANT,
} from './constants.js';
import { DEFAULT_DISABLED_COMMANDS, SIMON_COMMAND_POOL } from './simonCommands.js';
import { DEFAULT_DISABLED_AMBIENT_SIGNALS, AMBIENT_SIGNALS } from './ambientSignals.js';

export const GAME_MODES = ['freeze', 'simon'];
export const DEFAULT_GAME_MODE = 'freeze';

const SETTINGS_KEY = 'cuida-freeze-settings';
const TELEMETRY_KEY = 'cuida-freeze-telemetry';

// Telemetry (live movement reading) is written on every frame if unthrottled;
// cap it so cross-tab writes stay cheap without feeling laggy on the meter.
export const TELEMETRY_MIN_INTERVAL_MS = 100;

// Telemetry older than this is treated as "no admin/game tab on the other end".
export const TELEMETRY_STALE_MS = 2000;

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota) — sync silently degrades.
  }
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

// Facial gestures and blinks are armed by default. A few involuntary blinks
// are tolerated in the default round.
export const DEFAULT_SETTINGS = {
  // Game mode & general round config
  freezeSeconds: DEFAULT_FREEZE_SECONDS,
  sensitivity: DEFAULT_SENSITIVITY,
  detectGestures: true,
  detectBlink: true,
  blinkBudget: 3,
  gameMode: DEFAULT_GAME_MODE,
  simonPreset: DEFAULT_SIMON_PRESET,
  simonStickerThreshold: DEFAULT_STICKER_THRESHOLD,
  simonPenThreshold: DEFAULT_PEN_THRESHOLD,

  // Hardware Acceleration (GPU / CPU) & Model Variant
  inferenceDelegate: DEFAULT_INFERENCE_DELEGATE, // 'GPU' | 'GPU_LOW_POWER' | 'CPU'
  poseModelVariant: DEFAULT_POSE_MODEL_VARIANT,   // 'lite' | 'full' | 'heavy'

  // Video / Camera source configuration
  videoSourceType: DEFAULT_VIDEO_SOURCE_TYPE, // 'webcam' | 'http' | 'file'
  videoDeviceId: '',
  videoSourceUrl: '',
  httpStreamMode: DEFAULT_HTTP_STREAM_MODE, // 'auto' | 'mjpeg' | 'video' | 'snapshot'
  useCameraProxy: true,
  videoFileName: '',
  videoFileSize: 0,
  videoFileUpdatedAt: 0,
  videoLoop: true,
  mirrorVideo: true,

  // Skeleton smoothing & occlusion handling
  poseSmoothing: DEFAULT_POSE_SMOOTHING, // 0..0.95
  occlusionDamping: DEFAULT_OCCLUSION_DAMPING,
  occlusionHoldMs: DEFAULT_OCCLUSION_HOLD_MS, // 0..1500
  minLandmarkVisibility: MIN_LANDMARK_VISIBILITY, // 0.25..0.90
  minPoseConfidence: MIN_POSE_CONFIDENCE, // 0.25..0.90
  hideNoisyExtremities: DEFAULT_HIDE_NOISY_EXTREMITIES,

  // Fine-tuning parameters for Freeze mode
  customDynamicThreshold: SENSITIVITY_LEVELS[DEFAULT_SENSITIVITY].threshold,
  customAnchorThreshold: SENSITIVITY_LEVELS[DEFAULT_SENSITIVITY].anchorThreshold,
  customGestureThreshold: SENSITIVITY_LEVELS[DEFAULT_SENSITIVITY].gestureThreshold,
  breachConfirmFrames: BREACH_CONFIRM_FRAMES,
  poseLossGraceMs: POSE_LOSS_GRACE_MS,
  zoneWeightHead: ZONE_WEIGHTS.head,
  zoneWeightTorso: ZONE_WEIGHTS.torso,
  zoneWeightArms: ZONE_WEIGHTS.arms,
  zoneWeightLegs: ZONE_WEIGHTS.legs,

  // Fine-tuning parameters for Simon Says mode
  simonCommandCount: SIMON_PRESETS[DEFAULT_SIMON_PRESET].commandCount,
  simonCommandSeconds: SIMON_PRESETS[DEFAULT_SIMON_PRESET].commandSeconds,
  simonConfirmFrames: SIMON_POSE_CONFIRM_FRAMES,
  simonArmsUpMargin: SIMON_ARMS_UP_MARGIN,
  simonArmsDownMargin: SIMON_ARMS_DOWN_MARGIN,
  simonTouchMargin: SIMON_TOUCH_MARGIN,
  disabledCommands: DEFAULT_DISABLED_COMMANDS,

  // Ambient / passer-by detections while waiting to start
  showAmbientTag: true,
  showAmbientSensors: true,
  showAmbientMotion: true,
  disabledAmbientSignals: DEFAULT_DISABLED_AMBIENT_SIGNALS,
};

/**
 * Keeps only values this version understands, so a stale or foreign write
 * (e.g. another build sharing the origin) can never put the game in a state
 * it cannot render.
 */
export function sanitizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;

  if (Number.isFinite(raw.freezeSeconds)) {
    s.freezeSeconds = clamp(Math.round(raw.freezeSeconds), MIN_FREEZE_SECONDS, MAX_FREEZE_SECONDS);
  }
  if (Object.hasOwn(SENSITIVITY_LEVELS, raw.sensitivity)) {
    s.sensitivity = raw.sensitivity;
    // Default custom thresholds to the selected sensitivity preset if not explicitly provided
    s.customDynamicThreshold = SENSITIVITY_LEVELS[s.sensitivity].threshold;
    s.customAnchorThreshold = SENSITIVITY_LEVELS[s.sensitivity].anchorThreshold;
    s.customGestureThreshold = SENSITIVITY_LEVELS[s.sensitivity].gestureThreshold;
  }

  for (const key of [
    'detectGestures',
    'detectBlink',
    'useCameraProxy',
    'videoLoop',
    'mirrorVideo',
    'occlusionDamping',
    'hideNoisyExtremities',
    'showAmbientTag',
    'showAmbientSensors',
    'showAmbientMotion',
  ]) {
    if (typeof raw[key] === 'boolean') s[key] = raw[key];
  }

  if (Number.isInteger(raw.blinkBudget) && raw.blinkBudget >= 0) {
    s.blinkBudget = clamp(raw.blinkBudget, 0, 20);
  }
  if (GAME_MODES.includes(raw.gameMode)) s.gameMode = raw.gameMode;
  if (Object.hasOwn(SIMON_PRESETS, raw.simonPreset)) {
    s.simonPreset = raw.simonPreset;
    s.simonCommandCount = SIMON_PRESETS[s.simonPreset].commandCount;
    s.simonCommandSeconds = SIMON_PRESETS[s.simonPreset].commandSeconds;
  }
  if (Number.isInteger(raw.simonStickerThreshold)) {
    s.simonStickerThreshold = clamp(raw.simonStickerThreshold, MIN_REWARD_THRESHOLD, MAX_REWARD_THRESHOLD);
  }
  if (Number.isInteger(raw.simonPenThreshold)) {
    s.simonPenThreshold = clamp(raw.simonPenThreshold, MIN_REWARD_THRESHOLD, MAX_REWARD_THRESHOLD);
  }

  // GPU / CPU & Pose Model Variant
  if (INFERENCE_DELEGATES.includes(raw.inferenceDelegate)) {
    s.inferenceDelegate = raw.inferenceDelegate;
  }
  if (Object.hasOwn(POSE_MODEL_VARIANTS, raw.poseModelVariant)) {
    s.poseModelVariant = raw.poseModelVariant;
  }

  // Video source settings
  if (VIDEO_SOURCE_TYPES.includes(raw.videoSourceType)) {
    s.videoSourceType = raw.videoSourceType;
  }
  if (typeof raw.videoDeviceId === 'string') {
    s.videoDeviceId = raw.videoDeviceId;
  }
  if (typeof raw.videoSourceUrl === 'string') {
    s.videoSourceUrl = raw.videoSourceUrl.trim();
  }
  if (HTTP_STREAM_MODES.includes(raw.httpStreamMode)) {
    s.httpStreamMode = raw.httpStreamMode;
  }
  if (typeof raw.videoFileName === 'string') {
    s.videoFileName = raw.videoFileName;
  }
  if (Number.isFinite(raw.videoFileSize) && raw.videoFileSize >= 0) {
    s.videoFileSize = raw.videoFileSize;
  }
  if (Number.isFinite(raw.videoFileUpdatedAt) && raw.videoFileUpdatedAt >= 0) {
    s.videoFileUpdatedAt = raw.videoFileUpdatedAt;
  }

  // Smoothing & occlusion settings
  if (Number.isFinite(raw.poseSmoothing)) {
    s.poseSmoothing = clamp(Number(raw.poseSmoothing), 0, 0.95);
  }
  if (Number.isFinite(raw.occlusionHoldMs)) {
    s.occlusionHoldMs = clamp(Math.round(raw.occlusionHoldMs), 0, 1500);
  }
  if (Number.isFinite(raw.minLandmarkVisibility)) {
    s.minLandmarkVisibility = clamp(Number(raw.minLandmarkVisibility), 0.25, 0.90);
  }
  if (Number.isFinite(raw.minPoseConfidence)) {
    s.minPoseConfidence = clamp(Number(raw.minPoseConfidence), 0.25, 0.90);
  }

  // Freeze fine-tuning settings
  if (Number.isFinite(raw.customDynamicThreshold)) {
    s.customDynamicThreshold = clamp(Number(raw.customDynamicThreshold), 0.003, 0.060);
  }
  if (Number.isFinite(raw.customAnchorThreshold)) {
    s.customAnchorThreshold = clamp(Number(raw.customAnchorThreshold), 0.008, 0.120);
  }
  if (Number.isFinite(raw.customGestureThreshold)) {
    s.customGestureThreshold = clamp(Number(raw.customGestureThreshold), 0.05, 0.50);
  }
  if (Number.isFinite(raw.breachConfirmFrames)) {
    s.breachConfirmFrames = clamp(Math.round(raw.breachConfirmFrames), 1, 15);
  }
  if (Number.isFinite(raw.poseLossGraceMs)) {
    s.poseLossGraceMs = clamp(Math.round(raw.poseLossGraceMs), 200, 3000);
  }
  if (Number.isFinite(raw.zoneWeightHead)) {
    s.zoneWeightHead = clamp(Number(raw.zoneWeightHead), 0, 3);
  }
  if (Number.isFinite(raw.zoneWeightTorso)) {
    s.zoneWeightTorso = clamp(Number(raw.zoneWeightTorso), 0, 3);
  }
  if (Number.isFinite(raw.zoneWeightArms)) {
    s.zoneWeightArms = clamp(Number(raw.zoneWeightArms), 0, 3);
  }
  if (Number.isFinite(raw.zoneWeightLegs)) {
    s.zoneWeightLegs = clamp(Number(raw.zoneWeightLegs), 0, 3);
  }

  // Simon Says fine-tuning settings
  if (Number.isFinite(raw.simonCommandCount)) {
    s.simonCommandCount = clamp(Math.round(raw.simonCommandCount), 3, 20);
  }
  if (Number.isFinite(raw.simonCommandSeconds)) {
    s.simonCommandSeconds = clamp(Number(raw.simonCommandSeconds), 1.5, 10);
  }
  if (Number.isFinite(raw.simonConfirmFrames)) {
    s.simonConfirmFrames = clamp(Math.round(raw.simonConfirmFrames), 1, 10);
  }
  if (Number.isFinite(raw.simonArmsUpMargin)) {
    s.simonArmsUpMargin = clamp(Number(raw.simonArmsUpMargin), 0.02, 0.40);
  }
  if (Number.isFinite(raw.simonArmsDownMargin)) {
    s.simonArmsDownMargin = clamp(Number(raw.simonArmsDownMargin), 0.02, 0.40);
  }
  if (Number.isFinite(raw.simonTouchMargin)) {
    s.simonTouchMargin = clamp(Number(raw.simonTouchMargin), 0.05, 0.45);
  }
  if (Array.isArray(raw.disabledCommands)) {
    const validIds = new Set(SIMON_COMMAND_POOL.map((c) => c.id));
    s.disabledCommands = raw.disabledCommands.filter((id) => typeof id === 'string' && validIds.has(id));
  }
  if (Array.isArray(raw.disabledAmbientSignals)) {
    const validAmbientIds = new Set(AMBIENT_SIGNALS.map((c) => c.id));
    s.disabledAmbientSignals = raw.disabledAmbientSignals.filter((id) => typeof id === 'string' && validAmbientIds.has(id));
  }

  return s;
}

export function readSettings() {
  return sanitizeSettings(readJSON(SETTINGS_KEY));
}

export function writeSettings(settings) {
  writeJSON(SETTINGS_KEY, sanitizeSettings(settings));
}

export function readTelemetry() {
  return readJSON(TELEMETRY_KEY);
}

export function writeTelemetry(telemetry) {
  writeJSON(TELEMETRY_KEY, { ...telemetry, ts: Date.now() });
}

/** Subscribes to changes to one synced key made from another tab. */
function subscribe(key, callback) {
  const handler = (e) => {
    if (e.key !== key || e.newValue == null) return;
    try {
      callback(JSON.parse(e.newValue));
    } catch {
      // Ignore malformed writes from an older/newer version of this page.
    }
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

export function subscribeSettings(callback) {
  return subscribe(SETTINGS_KEY, (raw) => callback(sanitizeSettings(raw)));
}

export function subscribeTelemetry(callback) {
  return subscribe(TELEMETRY_KEY, callback);
}
