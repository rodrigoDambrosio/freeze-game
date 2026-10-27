/**
 * vitalityAnalyzer.js
 *
 * Signs-of-life detection — the inverse of the Freeze Challenge. There, motion
 * is the infraction; here, the ABSENCE of motion is what raises the alarm.
 *
 * Four independent signals, ordered from the most specific sign of a conscious
 * person to the subtlest sign of a living one:
 *
 *  1. Blinking      — a conscious person blinks 12-20 times a minute. The
 *                     single most specific sign, and the one a close-up
 *                     framing reads best.
 *  2. Expression    — jaw, brows, mouth. Speech, grimaces, micro-gestures.
 *  3. Head motion   — nobody conscious holds their head perfectly still.
 *  4. Breathing     — periodic rise and fall. Present even when unconscious,
 *                     so it is what separates "fainted but breathing" from
 *                     "no signal at all".
 *
 * Each signal is measured against the detector's own noise floor, so "no
 * movement" means below what this camera and this framing can resolve, rather
 * than below a number guessed in advance.
 *
 * This is a demonstration of the sensing approach, not a medical device: a
 * webcam cannot confirm that someone is breathing, and absence of a signal
 * here means the camera cannot see one, which is not the same as its absence.
 */

import {
  BLINK_THRESHOLD,
  BLINK_RELEASE,
  BLINK_RATE_WINDOW_MS,
  EXPRESSION_BLENDSHAPES,
  EXPRESSION_WINDOW_FRAMES,
  EXPRESSION_ACTIVE_STD,
  HEAD_MOTION_WINDOW_FRAMES,
  HEAD_MOTION_ACTIVE,
  BREATHING_WINDOW_FRAMES,
  BREATHING_MIN_RPM,
  BREATHING_MAX_RPM,
  BREATHING_MIN_CONFIDENCE,
  VITALITY_STILL_MS,
  VITALITY_ALERT_MS,
} from './constants.js';

export const VITALITY_STATE = {
  NO_SIGNAL: 'NO_SIGNAL',
  ACTIVE: 'ACTIVE',
  CALM: 'CALM',
  STILL: 'STILL',
  UNRESPONSIVE: 'UNRESPONSIVE',
};

export const VITALITY_LABELS = {
  NO_SIGNAL: 'Sin señal',
  ACTIVE: 'Activa',
  CALM: 'En reposo',
  STILL: 'Inmóvil',
  UNRESPONSIVE: 'Sin respuesta',
};

/** Standard deviation of a numeric list. */
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Look up one blendshape score by name, 0 when the model did not report it. */
function blendshapeScore(categories, name) {
  if (!categories) return 0;
  const hit = categories.find((c) => c.categoryName === name);
  return hit ? hit.score : 0;
}

/**
 * Strength of the dominant periodic component of a signal, within a band.
 *
 * Normalized autocorrelation: for each candidate period the signal is compared
 * with a copy of itself shifted by that many samples. Breathing shows up as a
 * strong match at a lag of two to seven seconds' worth of frames, which no
 * amount of random jitter produces.
 *
 * Returns the fundamental lag (in samples) and how strongly it correlates,
 * 0..1.
 */
export function findPeriodicity(signal, minLag, maxLag, smoothing = 5) {
  if (signal.length < maxLag * 2) return { lag: 0, confidence: 0 };

  // Breathing lives between 0.13 and 0.5 Hz while detector noise is much
  // faster, so a short moving average removes most of the noise and almost
  // none of the signal.
  const smooth = [];
  for (let i = 0; i < signal.length; i++) {
    const from = Math.max(0, i - smoothing + 1);
    let sum = 0;
    for (let k = from; k <= i; k++) sum += signal[k];
    smooth.push(sum / (i - from + 1));
  }

  const n = smooth.length;
  // Remove the slow drift that posture shifts add, so the correlation
  // describes the oscillation and not the trend underneath it.
  const mean = smooth.reduce((a, b) => a + b, 0) / n;
  const centered = smooth.map((v) => v - mean);

  let energy = 0;
  for (const v of centered) energy += v * v;
  if (energy < 1e-12) return { lag: 0, confidence: 0 };

  const scores = new Array(maxLag + 1).fill(-1);
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i + lag < n; i++) {
      sum += centered[i] * centered[i + lag];
      normA += centered[i] * centered[i];
      normB += centered[i + lag] * centered[i + lag];
    }
    const denom = Math.sqrt(normA * normB);
    if (denom < 1e-12) continue;
    const score = sum / denom;
    scores[lag] = score;
    if (score > bestScore) bestScore = score;
  }

  if (bestScore <= 0) return { lag: 0, confidence: 0 };

  // Autocorrelation peaks at every multiple of the true period, so the
  // tallest peak is often at two or three breaths rather than one — which
  // would report half or a third of the real rate. Take instead the
  // SHORTEST lag that peaks nearly as high: that is the fundamental.
  const acceptable = bestScore * 0.85;
  let fundamentalLag = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (scores[lag] < acceptable) continue;
    if (scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]) {
      fundamentalLag = lag;
      break;
    }
  }
  if (fundamentalLag === 0) {
    fundamentalLag = scores.indexOf(bestScore);
  }

  return { lag: fundamentalLag, confidence: Math.max(0, bestScore) };
}

/**
 * VitalityAnalyzer
 *
 * Fed one frame at a time; keeps the rolling history each signal needs.
 */
export class VitalityAnalyzer {
  constructor() {
    this.reset();
  }

  reset() {
    this._blinkTimes = [];
    this._eyeClosed = false;
    this._lastBlinkAt = null;

    this._expressionHistory = [];
    this._headHistory = [];
    this._breathSignal = [];

    this._frameTimes = [];
    this._lastMotionAt = null;
    this._startedAt = null;
    this._lastFaceAt = null;
  }

  /** Effective frame rate, measured rather than assumed. */
  _fps() {
    const t = this._frameTimes;
    if (t.length < 10) return 30;
    const span = (t[t.length - 1] - t[0]) / 1000;
    if (span <= 0) return 30;
    return (t.length - 1) / span;
  }

  /**
   * Feed one frame.
   *
   * @param blendshapes  face blendshape categories, or null when no face
   * @param faceLandmarks  face mesh landmarks, or null
   * @param poseLandmarks  body landmarks, or null
   * @param now  timestamp in ms
   */
  update({ blendshapes, faceLandmarks, poseLandmarks, now = performance.now() }) {
    if (this._startedAt === null) this._startedAt = now;

    this._frameTimes.push(now);
    if (this._frameTimes.length > 120) this._frameTimes.shift();

    const hasFace = !!blendshapes || !!faceLandmarks;
    const hasBody = !!poseLandmarks;
    if (hasFace) this._lastFaceAt = now;

    if (!hasFace && !hasBody) {
      return this._report({ state: VITALITY_STATE.NO_SIGNAL, now });
    }

    // ── 1. Blinking ────────────────────────────────────────────────────────
    // Both eyes averaged, with a hysteresis band so a value hovering at the
    // threshold does not register as a burst of blinks.
    let blinkValue = 0;
    if (blendshapes) {
      blinkValue = (
        blendshapeScore(blendshapes, 'eyeBlinkLeft') +
        blendshapeScore(blendshapes, 'eyeBlinkRight')
      ) / 2;

      if (!this._eyeClosed && blinkValue > BLINK_THRESHOLD) {
        this._eyeClosed = true;
        this._blinkTimes.push(now);
        this._lastBlinkAt = now;
      } else if (this._eyeClosed && blinkValue < BLINK_RELEASE) {
        this._eyeClosed = false;
      }
    }
    this._blinkTimes = this._blinkTimes.filter((t) => now - t <= BLINK_RATE_WINDOW_MS);

    const observedMs = Math.min(now - this._startedAt, BLINK_RATE_WINDOW_MS);
    const blinkRate = observedMs > 3000
      ? (this._blinkTimes.length * 60000) / observedMs
      : null;

    // ── 2. Facial expression ───────────────────────────────────────────────
    // Movement of the expressive blendshapes, as their spread over a few
    // seconds. A still face holds them flat; speech or a grimace moves them.
    if (blendshapes) {
      const sum = EXPRESSION_BLENDSHAPES.reduce(
        (acc, name) => acc + blendshapeScore(blendshapes, name), 0
      );
      this._expressionHistory.push(sum);
      if (this._expressionHistory.length > EXPRESSION_WINDOW_FRAMES) {
        this._expressionHistory.shift();
      }
    }
    const expressionActivity = stdDev(this._expressionHistory);

    // ── 3. Head motion ─────────────────────────────────────────────────────
    // Nose tip against head width, so the measure is independent of how close
    // the person sits to the camera.
    let headActivity = 0;
    const nose = faceLandmarks?.[1] ?? poseLandmarks?.[0];
    if (nose) {
      let headScale = 0.08;
      if (poseLandmarks?.[7] && poseLandmarks?.[8]) {
        const dx = poseLandmarks[7].x - poseLandmarks[8].x;
        const dy = poseLandmarks[7].y - poseLandmarks[8].y;
        const d = Math.hypot(dx, dy);
        if (d > 0.02) headScale = d;
      }
      this._headHistory.push({ x: nose.x / headScale, y: nose.y / headScale });
      if (this._headHistory.length > HEAD_MOTION_WINDOW_FRAMES) this._headHistory.shift();

      headActivity = Math.max(
        stdDev(this._headHistory.map((p) => p.x)),
        stdDev(this._headHistory.map((p) => p.y))
      );
    }

    // ── 4. Breathing ───────────────────────────────────────────────────────
    // Vertical position of the shoulder line, or of the head in a close-up
    // where the shoulders are out of frame. Breathing moves it a millimetre or
    // two, far too little to see as a displacement — but it repeats, and
    // periodicity survives noise that amplitude does not.
    let breathSample = null;
    if (poseLandmarks?.[11] && poseLandmarks?.[12]) {
      breathSample = (poseLandmarks[11].y + poseLandmarks[12].y) / 2;
    } else if (nose) {
      breathSample = nose.y;
    }
    if (breathSample !== null) {
      this._breathSignal.push(breathSample);
      if (this._breathSignal.length > BREATHING_WINDOW_FRAMES) this._breathSignal.shift();
    }

    const fps = this._fps();
    const minLag = Math.round((60 / BREATHING_MAX_RPM) * fps);
    const maxLag = Math.round((60 / BREATHING_MIN_RPM) * fps);
    const { lag, confidence } = findPeriodicity(this._breathSignal, minLag, maxLag);
    const breathingDetected = confidence >= BREATHING_MIN_CONFIDENCE && lag > 0;
    const breathingRate = breathingDetected ? (60 * fps) / lag : null;

    // ── Decide the state ───────────────────────────────────────────────────
    const blinkedRecently =
      this._lastBlinkAt !== null && now - this._lastBlinkAt < VITALITY_STILL_MS;
    const expressive = expressionActivity > EXPRESSION_ACTIVE_STD;
    const headMoving = headActivity > HEAD_MOTION_ACTIVE;

    const consciousSign = blinkedRecently || expressive || headMoving;
    if (consciousSign) this._lastMotionAt = now;

    const stillMs = this._lastMotionAt === null
      ? now - this._startedAt
      : now - this._lastMotionAt;

    let state;
    if (!hasFace && !hasBody) {
      state = VITALITY_STATE.NO_SIGNAL;
    } else if (
      headActivity > HEAD_MOTION_ACTIVE * 2 ||
      expressionActivity > EXPRESSION_ACTIVE_STD * 3
    ) {
      state = VITALITY_STATE.ACTIVE;
    } else if (consciousSign) {
      state = VITALITY_STATE.CALM;
    } else if (stillMs < VITALITY_STILL_MS) {
      state = VITALITY_STATE.CALM;
    } else if (breathingDetected || stillMs < VITALITY_ALERT_MS) {
      state = VITALITY_STATE.STILL;
    } else {
      state = VITALITY_STATE.UNRESPONSIVE;
    }

    return this._report({
      state, now, blinkValue, blinkRate,
      blinkCount: this._blinkTimes.length,
      lastBlinkAgo: this._lastBlinkAt === null ? null : now - this._lastBlinkAt,
      expressionActivity, headActivity,
      breathingDetected, breathingRate, breathingConfidence: confidence,
      stillMs, fps,
      samples: this._breathSignal.length,
      breathingWindowNeeded: maxLag * 2,
    });
  }

  _report(data) {
    const { state } = data;
    return {
      ...data,
      label: VITALITY_LABELS[state],
      isAlert: state === VITALITY_STATE.UNRESPONSIVE,
      isWarning: state === VITALITY_STATE.STILL,
    };
  }
}
