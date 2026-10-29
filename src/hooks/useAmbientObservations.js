/**
 * useAmbientObservations.js
 *
 * While nobody is playing, the camera keeps watching whoever walks past the
 * stand. This hook builds a live description of that person — a visitor
 * number, whether they are walking or standing still, and any posture or
 * facial expression from ambientSignals.js whose confidence exceeds 65% —
 * for the tag drawn next to them.
 */
import { useRef, useState, useCallback } from 'react';
import {
  AMBIENT_OBS_RELEASE_MS,
  AMBIENT_PERSON_GONE_MS,
  AMBIENT_MOTION_WINDOW_MS,
  AMBIENT_WALK_SPEED,
  AMBIENT_STILL_SPEED,
} from '../lib/constants.js';
import {
  AMBIENT_SIGNALS,
  AMBIENT_POSE_SIGNALS,
  AMBIENT_FACE_SIGNALS,
  AMBIENT_MIN_CONFIDENCE,
  isAmbientSignalEnabled,
  isAmbientMotionEnabled,
  bodyCenterX,
} from '../lib/ambientSignals.js';

function createSignalState() {
  return { count: 0, active: false, lastSeenAt: 0, value: null };
}

function updateSignal(state, signal, matched, value, now) {
  const highEnough = value == null || value > AMBIENT_MIN_CONFIDENCE;
  if (matched && highEnough) {
    state.count += 1;
    state.lastSeenAt = now;
    state.value = value;
    if (state.count >= signal.confirmFrames) state.active = true;
  } else {
    state.count = 0;
    if (state.active && now - state.lastSeenAt > AMBIENT_OBS_RELEASE_MS) state.active = false;
  }
}

/**
 * Returns { observation, onFrame, onFaceFrame }. `observation` is null while
 * nobody is in frame, otherwise:
 *   { personNumber, motion: 'left' | 'right' | 'still' | null,
 *     tags: [{ id, label, icon, percent? }] }
 * where `motion` is the on-screen direction (the feed is mirrored).
 */
export function useAmbientObservations() {
  const [observation, setObservation] = useState(null);

  const signalsRef = useRef(Object.fromEntries(AMBIENT_SIGNALS.map((s) => [s.id, createSignalState()])));
  const presentRef = useRef(false);
  const lastPersonAtRef = useRef(-Infinity);
  const personNumberRef = useRef(0);
  const motionSamplesRef = useRef([]);
  const motionRef = useRef(null);
  const publishedKeyRef = useRef('');

  const _publish = useCallback(() => {
    let next = null;
    if (presentRef.current) {
      const tags = [];
      for (const signal of AMBIENT_SIGNALS) {
        if (!isAmbientSignalEnabled(signal.id)) continue;
        const s = signalsRef.current[signal.id];
        if (!s?.active) continue;
        if (s.value != null && s.value <= AMBIENT_MIN_CONFIDENCE) continue;
        const tag = { id: signal.id, label: signal.label, icon: signal.icon };
        // 5% steps: a live reading, without re-rendering on every decimal.
        if (s.value != null) {
          const pct = Math.min(100, Math.round((s.value * 100) / 5) * 5);
          if (pct > 65) tag.percent = pct;
          else continue;
        }
        tags.push(tag);
      }

      next = {
        personNumber: personNumberRef.current,
        motion: isAmbientMotionEnabled() ? motionRef.current : null,
        tags,
      };
    }
    const key = JSON.stringify(next);
    if (key === publishedKeyRef.current) return;
    publishedKeyRef.current = key;
    setObservation(next);
  }, []);

  const _updateMotion = useCallback((landmarks, now) => {
    const x = bodyCenterX(landmarks);
    const samples = motionSamplesRef.current;
    if (x == null) {
      motionSamplesRef.current = [];
      motionRef.current = null;
      return;
    }
    samples.push({ t: now, x });
    while (samples.length && now - samples[0].t > AMBIENT_MOTION_WINDOW_MS) samples.shift();

    const first = samples[0];
    const span = now - first.t;
    if (span < AMBIENT_MOTION_WINDOW_MS * 0.6) return; // not enough history yet
    const speed = (x - first.x) / (span / 1000);
    if (Math.abs(speed) > AMBIENT_WALK_SPEED) {
      // Mirrored feed: moving toward higher x reads as moving left on screen.
      motionRef.current = speed > 0 ? 'left' : 'right';
    } else if (Math.abs(speed) < AMBIENT_STILL_SPEED) {
      motionRef.current = 'still';
    }
  }, []);

  /** Called every pose frame (null when nobody is in frame). */
  const onFrame = useCallback((landmarks) => {
    const now = performance.now();

    if (landmarks) {
      if (!presentRef.current && now - lastPersonAtRef.current > AMBIENT_PERSON_GONE_MS) {
        personNumberRef.current += 1;
      }
      presentRef.current = true;
      lastPersonAtRef.current = now;
    } else {
      presentRef.current = false;
    }

    _updateMotion(landmarks, now);
    for (const signal of AMBIENT_POSE_SIGNALS) {
      if (!signalsRef.current[signal.id]) {
        signalsRef.current[signal.id] = createSignalState();
      }
      const matched = signal.classifier(landmarks);
      const value = matched && signal.value ? signal.value(landmarks) : null;
      updateSignal(signalsRef.current[signal.id], signal, matched, value, now);
    }
    _publish();
  }, [_updateMotion, _publish]);

  /** Called every face frame. */
  const onFaceFrame = useCallback(({ blendshapes } = {}) => {
    const now = performance.now();
    for (const signal of AMBIENT_FACE_SIGNALS) {
      if (!signalsRef.current[signal.id]) {
        signalsRef.current[signal.id] = createSignalState();
      }
      const matched = presentRef.current && signal.classifier(blendshapes);
      const value = matched && signal.value ? signal.value(blendshapes) : null;
      updateSignal(signalsRef.current[signal.id], signal, matched, value, now);
    }
    _publish();
  }, [_publish]);

  return { observation, onFrame, onFaceFrame };
}
