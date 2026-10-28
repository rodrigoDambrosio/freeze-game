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

// Stricter than the analyzer's gate, and for the opposite reason: the analyzer
// can afford a noisy landmark because it averages over a zone, while a single
// invented joint drawn on screen is read by the player as something the system
// claims to have seen. With a head-and-shoulders framing MediaPipe still emits
// hips and legs with middling confidence, so they are dropped here.
const DRAW_MIN_VISIBILITY = 0.62;

// Landmarks outside the frame are extrapolated, never observed.
const FRAME_MARGIN = 0.02;

function isInFrame(lm) {
  return lm.x >= -FRAME_MARGIN && lm.x <= 1 + FRAME_MARGIN
    && lm.y >= -FRAME_MARGIN && lm.y <= 1 + FRAME_MARGIN;
}

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
  return !!lm && (lm.visibility ?? 1) >= DRAW_MIN_VISIBILITY && isInFrame(lm);
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
 * The path the telltale joint actually travelled through the replayed window,
 * faint where it started and solid at the instant of the detection.
 *
 * This replaces a pulsing marker on the same spot: the marker only said
 * "here", while the trail is the measurement itself — proof the player was
 * never still, drawn from the same landmarks the detector read.
 *
 * `upTo` lets the trail draw itself as the footage plays.
 */
export function drawMotionTrail(ctx, points, W, H, color = '#ff6b6b', upTo = Infinity) {
  if (!points || points.length < 2) return;
  const n = Math.max(2, Math.min(points.length, Math.round(upTo)));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.strokeStyle = color;

  for (let i = 1; i < n; i++) {
    const age = i / (n - 1); // 0 = oldest sample, 1 = the detection
    ctx.beginPath();
    ctx.globalAlpha = 0.12 + 0.78 * age;
    ctx.lineWidth = 1.2 + 2.3 * age;
    ctx.moveTo(points[i - 1].x * W, points[i - 1].y * H);
    ctx.lineTo(points[i].x * W, points[i].y * H);
    ctx.stroke();
  }

  const head = points[n - 1];
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(head.x * W, head.y * H, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Darken everything but the area around `center`, so the eye goes where the
 * detection happened without anything being drawn on top of it.
 *
 * The rect is deliberately oversized: this runs inside the zoom transform,
 * where the canvas corners sit outside 0..W/0..H.
 */
export function drawFocusVignette(ctx, center, W, H, strength = 0.6) {
  if (!center || strength <= 0) return;

  const cx = center.x * W;
  const cy = center.y * H;
  const gradient = ctx.createRadialGradient(
    cx, cy, Math.min(W, H) * 0.16,
    cx, cy, Math.max(W, H) * 0.62,
  );
  gradient.addColorStop(0, 'rgba(5, 7, 13, 0)');
  gradient.addColorStop(1, `rgba(5, 7, 13, ${strength})`);

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(-W, -H, W * 3, H * 3);
  ctx.restore();
}

/**
 * Arrows from where each joint started to where it was when the system called
 * it. This is the whole point of the replay: the footage shows someone who
 * looks still, and these show the displacement that did not look like much but
 * crossed the threshold.
 *
 * Drawn at true scale — never stretched to be easier to see, since the length
 * is the evidence. The viewer zooms instead.
 */
export function drawDisplacementVectors(ctx, current, anchor, W, H, indices, color = '#ff6b6b', alpha = 1) {
  if (!current || !anchor || !indices?.length || alpha <= 0) return;

  // Below this the arrow is shorter than its own head and reads as a smudge.
  const MIN_VISIBLE_DELTA = 0.004;

  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  for (const idx of indices) {
    const curr = current[idx];
    const prev = anchor[idx];
    if (!isDrawable(curr) || !isDrawable(prev)) continue;
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) < MIN_VISIBLE_DELTA) continue;

    const x0 = prev.x * W;
    const y0 = prev.y * H;
    const x1 = curr.x * W;
    const y1 = curr.y * H;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = 9;

    ctx.globalAlpha = 0.95 * alpha;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 7), y1 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 7), y1 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Zoom the canvas around `center` (normalized), clamped so the view never
 * runs past the edges of the footage and shows empty canvas.
 */
export function applyZoom(ctx, center, scale, W, H) {
  if (!center || scale <= 1) return;

  const halfW = W / (2 * scale);
  const halfH = H / (2 * scale);
  const cx = Math.min(W - halfW, Math.max(halfW, center.x * W));
  const cy = Math.min(H - halfH, Math.max(halfH, center.y * H));

  ctx.translate(W / 2, H / 2);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
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
