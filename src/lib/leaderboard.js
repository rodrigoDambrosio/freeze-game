/**
 * leaderboard.js
 *
 * Local top-5 scoreboard per game mode, shown on the idle/attract screen
 * while nobody is playing. Same localStorage + `storage` event pattern as
 * adminSync.js, so a saved score shows up on the idle screen live, with no
 * server involved and no data leaving the tab.
 */
import { LEADERBOARD_SIZE, LEADERBOARD_NAME_MAX_LENGTH } from './constants.js';

const KEYS = {
  freeze: 'cuida-freeze-leaderboard',
  simon: 'cuida-simon-leaderboard',
};

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota) — leaderboard just stops persisting.
  }
}

/** Entries for a mode, most recent write already sorted/trimmed. */
export function readLeaderboard(mode) {
  const key = KEYS[mode];
  return key ? readJSON(key) : [];
}

/**
 * Adds a score and keeps only the top LEADERBOARD_SIZE entries.
 * `value` is seconds survived for 'freeze' and points for 'simon'.
 */
export function addScore(mode, name, value) {
  const key = KEYS[mode];
  if (!key) return [];

  const cleanName = String(name ?? '').trim().slice(0, LEADERBOARD_NAME_MAX_LENGTH);
  if (!cleanName) return readJSON(key);

  const entry = { name: cleanName, value: Math.max(0, Number(value) || 0), ts: Date.now() };
  const next = [...readJSON(key), entry]
    .sort((a, b) => b.value - a.value)
    .slice(0, LEADERBOARD_SIZE);
  writeJSON(key, next);
  return next;
}

export function clearLeaderboard(mode) {
  const key = KEYS[mode];
  if (key) writeJSON(key, []);
}

/** Subscribes to a leaderboard changing from another tab/window. */
export function subscribeLeaderboard(mode, callback) {
  const key = KEYS[mode];
  if (!key) return () => {};
  const handler = (e) => {
    if (e.key !== key) return;
    callback(readJSON(key));
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
