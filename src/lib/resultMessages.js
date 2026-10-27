/**
 * resultMessages.js
 *
 * Copy helper for the loss modal: a motivational message tiered by how much
 * of the freeze was survived.
 */
import { LOST_MESSAGE_TIERS } from './constants.js';

function formatTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

/**
 * @param {number} survivedSeconds - time survived before the breach, in seconds
 * @param {number} freezeSeconds - the configured freeze duration
 */
export function getLostMessage(survivedSeconds, freezeSeconds) {
  const safeFreeze = freezeSeconds > 0 ? freezeSeconds : 1;
  const fraction = Math.max(0, Math.min(1, survivedSeconds / safeFreeze));
  const tier = LOST_MESSAGE_TIERS.find((t) => fraction <= t.max) ?? LOST_MESSAGE_TIERS[LOST_MESSAGE_TIERS.length - 1];

  const survivedLabel = survivedSeconds < 10 ? survivedSeconds.toFixed(1) : Math.round(survivedSeconds).toString();

  return {
    title: tier.title,
    subtitle: formatTemplate(tier.subtitle, { survived: survivedLabel, total: freezeSeconds }),
  };
}
