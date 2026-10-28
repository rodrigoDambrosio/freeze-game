/**
 * resultMessages.js
 *
 * Copy helper for the loss modal: the verdict on how far the player got,
 * tiered by how much of the freeze they survived.
 */
import { LOST_MESSAGE_TIERS } from './constants.js';

/**
 * @param {number} survivedSeconds - time survived before the breach, in seconds
 * @param {number} freezeSeconds - the configured freeze duration
 * @returns {string} the verdict headline
 */
export function getLostTitle(survivedSeconds, freezeSeconds) {
  const safeFreeze = freezeSeconds > 0 ? freezeSeconds : 1;
  const fraction = Math.max(0, Math.min(1, survivedSeconds / safeFreeze));
  const tier = LOST_MESSAGE_TIERS.find((t) => fraction <= t.max)
    ?? LOST_MESSAGE_TIERS[LOST_MESSAGE_TIERS.length - 1];
  return tier.title;
}

/** Seconds survived, kept precise while the number is small. */
export function formatSurvived(survivedSeconds) {
  return survivedSeconds < 10
    ? survivedSeconds.toFixed(1)
    : Math.round(survivedSeconds).toString();
}
