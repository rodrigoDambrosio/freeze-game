/**
 * replayDrawing.js
 *
 * Canvas helpers for the loss replay. Kept apart from poseAnalyzer.js so the
 * replay can evolve without touching the detection code.
 */
import {
  HEAD_LANDMARK_INDICES,
  TORSO_LANDMARK_INDICES,
  ARMS_LANDMARK_INDICES,
  LEGS_LANDMARK_INDICES,
  TRACKED_LANDMARK_INDICES,
  MIN_LANDMARK_VISIBILITY,
} from './constants.js';

// Looser than the analyzer's gate: the replay is a picture, not a measurement.
const DRAW_MIN_VISIBILITY = 0.35;

const SKELETON_CONNECTIONS = [
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

const MAJOR_LANDMARK_INDICES = [0, 7, 8, 11, 12, 23, 24];

function getZoneForIndex(idx) {
  if (HEAD_LANDMARK_INDICES.includes(idx)) return 'head';
  if (TORSO_LANDMARK_INDICES.includes(idx)) return 'torso';
  if (ARMS_LANDMARK_INDICES.includes(idx)) return 'arms';
  if (LEGS_LANDMARK_INDICES.includes(idx)) return 'legs';
  return null;
}

function isDrawable(lm) {
  return !!lm && (lm.visibility ?? 1) >= DRAW_MIN_VISIBILITY;
}

/**
 * Draw a pose skeleton.
 *
 * `options.activeZone` (head/torso/arms/legs) tints that zone in
 * `options.zoneColor`; `options.dashed` draws a translucent "ghost" skeleton
 * (e.g. the starting pose) for before/after comparison.
 */
export function drawReplaySkeleton(ctx, landmarks, W, H, color = '#5b9cf5', options = {}) {
  if (!landmarks) return;

  const {
    activeZone = null,
    zoneColor = '#ff6b6b',
    alpha = 0.75,
    dashed = false,
    lineWidth = 2.5,
  } = options;

  ctx.save();
  ctx.lineWidth = lineWidth;
  if (dashed) ctx.setLineDash([5, 4]);

  for (const [a, b] of SKELETON_CONNECTIONS) {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    if (!isDrawable(lmA) || !isDrawable(lmB)) continue;

    const isActiveBone = !!activeZone && getZoneForIndex(a) === activeZone && getZoneForIndex(b) === activeZone;

    ctx.beginPath();
    ctx.strokeStyle = isActiveBone ? zoneColor : color;
    ctx.globalAlpha = isActiveBone ? Math.min(1, alpha + 0.2) : alpha;
    ctx.moveTo(lmA.x * W, lmA.y * H);
    ctx.lineTo(lmB.x * W, lmB.y * H);
    ctx.stroke();
  }

  for (const idx of TRACKED_LANDMARK_INDICES) {
    const lm = landmarks[idx];
    if (!isDrawable(lm)) continue;

    const isActiveJoint = !!activeZone && getZoneForIndex(idx) === activeZone;
    const isMajor = MAJOR_LANDMARK_INDICES.includes(idx);

    ctx.beginPath();
    ctx.fillStyle = isActiveJoint ? zoneColor : color;
    ctx.globalAlpha = isActiveJoint ? 1 : alpha;
    ctx.arc(lm.x * W, lm.y * H, isActiveJoint ? (isMajor ? 6 : 5) : (isMajor ? 4.5 : 3.5), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Draw a pulsing "radar ping" halo centered on `center` (normalized coords).
 * `t` is a free-running clock in ms, so the halo keeps moving even while the
 * replay holds on its last frame.
 */
export function drawPulsingHalo(ctx, center, W, H, color = '#ff6b6b', t = 0) {
  if (!center) return;

  const x = center.x * W;
  const y = center.y * H;
  const minRadius = 10;
  const maxRadius = 34;
  const cyclesMs = 1100;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  for (let i = 0; i < 2; i++) {
    const phase = (((t + i * (cyclesMs / 2)) % cyclesMs) / cyclesMs);
    const radius = minRadius + (maxRadius - minRadius) * phase;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85 * (1 - phase);
    ctx.lineWidth = 3;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Mean position of the drawable landmarks in `indices`, or null. */
export function centroidOf(landmarks, indices) {
  if (!landmarks) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const idx of indices) {
    const lm = landmarks[idx];
    if (!isDrawable(lm)) continue;
    sx += lm.x;
    sy += lm.y;
    n++;
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

/**
 * The landmark within `indices` that moved the most between two poses, so
 * the halo points at the joint that actually gave the player away instead
 * of a zone's geometric middle (which can land in empty space).
 */
export function findMostMovedLandmark(current, previous, indices) {
  if (!current || !previous) return null;

  let best = null;
  for (const idx of indices) {
    const curr = current[idx];
    const prev = previous[idx];
    if (!curr || !prev) continue;
    if ((curr.visibility ?? 1) < MIN_LANDMARK_VISIBILITY || (prev.visibility ?? 1) < MIN_LANDMARK_VISIBILITY) continue;

    const distance = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (!best || distance > best.distance) best = { idx, distance };
  }
  return best;
}
