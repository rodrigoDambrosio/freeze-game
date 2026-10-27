/**
 * faceAnalyzer.js
 *
 * Facial gesture detection for the Freeze Challenge.
 *
 * Mirrors how the body is measured: a freeze pose is anchored at the start of
 * the round, and what counts as an infraction is the deviation from it. Here
 * the anchor is an expression rather than a posture — the 52 blendshape scores
 * MediaPipe reports per frame, of which this uses the expressive ones.
 *
 * Blinking is deliberately kept OUT of the gesture measure. It is involuntary,
 * so penalising it would make the game unwinnable; it is counted separately so
 * the interface can show that the system sees it without it costing the round.
 */

import {
  EXPRESSION_BLENDSHAPES,
  GESTURE_MEDIAN_WINDOW,
  GESTURE_CALIBRATION_FRAMES,
} from './constants.js';

/** Friendly Spanish names for the gestures worth calling out by name. */
const GESTURE_NAMES = {
  jawOpen: 'Abriste la boca',
  mouthSmileLeft: 'Sonreíste',
  mouthSmileRight: 'Sonreíste',
  mouthPucker: 'Moviste la boca',
  mouthFrownLeft: 'Moviste la boca',
  mouthFrownRight: 'Moviste la boca',
  browInnerUp: 'Levantaste las cejas',
  browDownLeft: 'Fruncíste el ceño',
  browDownRight: 'Fruncíste el ceño',
  cheekSquintLeft: 'Moviste la cara',
  cheekSquintRight: 'Moviste la cara',
  noseSneerLeft: 'Arrugaste la nariz',
  noseSneerRight: 'Arrugaste la nariz',
};

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Turn the category array into a plain name→score map. */
export function toScoreMap(categories) {
  const map = new Map();
  if (!categories) return map;
  for (const c of categories) map.set(c.categoryName, c.score);
  return map;
}

/**
 * FaceGestureAnalyzer
 *
 * Anchors the starting expression, then reports how far the current one has
 * moved from it — per blendshape, so the interface can name what changed.
 */
export class FaceGestureAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this._anchor = null;
    this._anchorSamples = [];
    this._recentDrifts = [];
    this._frameCount = 0;
    this._noiseFloor = new Map();
    this._noiseSamples = new Map();
  }

  /** Begin anchoring. Like the body anchor, it keeps averaging for a few frames. */
  setAnchor(categories) {
    const map = toScoreMap(categories);
    if (map.size === 0) {
      this._anchor = null;
      this._anchorSamples = [];
      return;
    }
    this._anchorSamples = [map];
    this._anchor = new Map(map);
  }

  _refineAnchor(map) {
    this._anchorSamples.push(map);
    const averaged = new Map();
    for (const name of EXPRESSION_BLENDSHAPES) {
      let sum = 0;
      for (const sample of this._anchorSamples) sum += sample.get(name) ?? 0;
      averaged.set(name, sum / this._anchorSamples.length);
    }
    this._anchor = averaged;
  }

  /**
   * Feed one frame of blendshapes.
   *
   * Returns the gesture drift from the anchor expression, which blendshape
   * moved most, and whether the measure can be trusted yet.
   */
  update(categories) {
    const map = toScoreMap(categories);
    if (map.size === 0) {
      return { drift: 0, isValid: false, reason: null, topGesture: null };
    }

    this._frameCount++;

    if (this._anchorSamples.length > 0 && this._anchorSamples.length < GESTURE_CALIBRATION_FRAMES) {
      this._refineAnchor(map);
    }

    // While calibrating, learn how much each blendshape wobbles on its own.
    // Some faces sit at a non-zero resting value that drifts; subtracting that
    // floor keeps a neutral face from reading as a gesture.
    if (this._frameCount <= GESTURE_CALIBRATION_FRAMES) {
      for (const name of EXPRESSION_BLENDSHAPES) {
        if (!this._noiseSamples.has(name)) this._noiseSamples.set(name, []);
        this._noiseSamples.get(name).push(map.get(name) ?? 0);
      }
      if (this._frameCount === GESTURE_CALIBRATION_FRAMES) {
        for (const [name, samples] of this._noiseSamples) {
          const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
          const spread = Math.sqrt(
            samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length
          );
          // Two standard deviations of resting wobble is not a gesture.
          this._noiseFloor.set(name, spread * 2);
        }
      }
    }

    if (!this._anchor) {
      return { drift: 0, isValid: false, reason: null, topGesture: null };
    }

    let topName = null;
    let topDelta = 0;
    const perShape = {};

    for (const name of EXPRESSION_BLENDSHAPES) {
      const current = map.get(name) ?? 0;
      const base = this._anchor.get(name) ?? 0;
      const floor = this._noiseFloor.get(name) ?? 0;

      const delta = Math.max(0, Math.abs(current - base) - floor);
      perShape[name] = delta;
      if (delta > topDelta) {
        topDelta = delta;
        topName = name;
      }
    }

    this._recentDrifts.push(topDelta);
    if (this._recentDrifts.length > GESTURE_MEDIAN_WINDOW) this._recentDrifts.shift();
    const drift = median(this._recentDrifts);

    return {
      drift,
      isValid:
        this._frameCount > GESTURE_CALIBRATION_FRAMES &&
        this._recentDrifts.length >= GESTURE_MEDIAN_WINDOW,
      reason: topName ? (GESTURE_NAMES[topName] ?? 'Gesto facial') : null,
      topGesture: topName,
      perShape,
    };
  }
}
