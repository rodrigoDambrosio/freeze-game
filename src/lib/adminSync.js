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
} from './constants.js';

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

// Facial gestures and blinks are armed by default. A few involuntary blinks
// are tolerated in the default round.
export const DEFAULT_SETTINGS = {
  freezeSeconds: DEFAULT_FREEZE_SECONDS,
  sensitivity: DEFAULT_SENSITIVITY,
  detectGestures: true,
  detectBlink: true,
  blinkBudget: 3,
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
    s.freezeSeconds = Math.min(MAX_FREEZE_SECONDS, Math.max(MIN_FREEZE_SECONDS, Math.round(raw.freezeSeconds)));
  }
  if (Object.hasOwn(SENSITIVITY_LEVELS, raw.sensitivity)) s.sensitivity = raw.sensitivity;
  for (const key of ['detectGestures', 'detectBlink']) {
    if (typeof raw[key] === 'boolean') s[key] = raw[key];
  }
  if (Number.isInteger(raw.blinkBudget) && raw.blinkBudget >= 0) s.blinkBudget = raw.blinkBudget;
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
