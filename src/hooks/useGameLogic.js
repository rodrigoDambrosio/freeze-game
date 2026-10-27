/**
 * useGameLogic.js
 *
 * State machine for the Freeze Challenge game.
 * States: IDLE → DETECTING → READY → PLAYING → WON | LOST
 *
 * Coordinates:
 *  - Game state transitions
 *  - Countdown timer
 *  - Multi-zone movement detection (head, torso, limbs)
 *  - Initial freeze pose baseline (Anchor Drift)
 *  - Specific infraction diagnostics (e.g. "Movimiento de cabeza")
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { MovementAnalyzer } from '../lib/poseAnalyzer.js';
import { FaceGestureAnalyzer } from '../lib/faceAnalyzer.js';
import { VitalityAnalyzer } from '../lib/vitalityAnalyzer.js';
import {
  DEFAULT_FREEZE_SECONDS,
  DEFAULT_SENSITIVITY,
  SENSITIVITY_LEVELS,
  BREACH_CONFIRM_FRAMES,
  POSE_LOSS_GRACE_MS,
  GESTURE_CONFIRM_FRAMES,
} from '../lib/constants.js';

export const GAME_STATE = {
  IDLE: 'IDLE',
  DETECTING: 'DETECTING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  WON: 'WON',
  LOST: 'LOST',
};

export function useGameLogic() {
  // ── Admin config ────────────────────────────────────────────────────────
  const [freezeSeconds, setFreezeSeconds] = useState(DEFAULT_FREEZE_SECONDS);
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);
  // Facial gestures are part of the freeze; blinking is involuntary, so it is
  // shown but never penalised unless the operator explicitly turns it on.
  const [detectGestures, setDetectGestures] = useState(true);
  const [penalizeBlink, setPenalizeBlink] = useState(false);

  // ── Game state ──────────────────────────────────────────────────────────
  const [gameState, setGameState] = useState(GAME_STATE.IDLE);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_FREEZE_SECONDS);
  const [movementScore, setMovementScore] = useState(0);
  const [infractionReason, setInfractionReason] = useState(null);
  // Live analyzer internals, for the diagnostics overlay.
  const [diagnostics, setDiagnostics] = useState(null);
  // Live signs-of-life read-out, shown during and after the round.
  const [vitality, setVitality] = useState(null);
  const [gestureDrift, setGestureDrift] = useState(0);

  // ── Internal refs (avoid closure staleness) ─────────────────────────────
  const gameStateRef = useRef(GAME_STATE.IDLE);
  const timerIntervalRef = useRef(null);
  const analyzerRef = useRef(new MovementAnalyzer());
  const faceAnalyzerRef = useRef(new FaceGestureAnalyzer());
  const vitalityRef = useRef(new VitalityAnalyzer());
  const freezeSecondsRef = useRef(freezeSeconds);
  const sensitivityRef = useRef(sensitivity);
  const detectGesturesRef = useRef(detectGestures);
  const penalizeBlinkRef = useRef(penalizeBlink);
  const timeLeftRef = useRef(freezeSeconds);
  const latestLandmarksRef = useRef(null);
  const isAnchorSetRef = useRef(false);
  // Timestamp of the first frame without a pose, or null while the pose is present.
  const poseLostSinceRef = useRef(null);
  const latestBlendshapesRef = useRef(null);
  const isFaceAnchorSetRef = useRef(false);
  const gestureFramesRef = useRef(0);
  const blinkCountRef = useRef(0);
  // Consecutive frames whose movement score is over the threshold.
  const breachFramesRef = useRef(0);

  // Keep refs in sync
  useEffect(() => {
    freezeSecondsRef.current = freezeSeconds;
    timeLeftRef.current = freezeSeconds;
    setTimeLeft(freezeSeconds);
  }, [freezeSeconds]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    detectGesturesRef.current = detectGestures;
  }, [detectGestures]);

  useEffect(() => {
    penalizeBlinkRef.current = penalizeBlink;
  }, [penalizeBlink]);

  const _setState = useCallback((s) => {
    gameStateRef.current = s;
    setGameState(s);
  }, []);

  // ── Timer helpers ───────────────────────────────────────────────────────
  const _startTimer = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timeLeftRef.current = freezeSecondsRef.current;
    setTimeLeft(freezeSecondsRef.current);

    timerIntervalRef.current = setInterval(() => {
      timeLeftRef.current -= 1;
      setTimeLeft(timeLeftRef.current);

      if (timeLeftRef.current <= 0) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
        _setState(GAME_STATE.WON);
      }
    }, 1000);
  }, [_setState]);

  const _stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // ── Public game actions ─────────────────────────────────────────────────

  /** Called when camera becomes active */
  const onCameraActivated = useCallback(() => {
    _setState(GAME_STATE.DETECTING);
    setInfractionReason(null);
    poseLostSinceRef.current = null;
    breachFramesRef.current = 0;
    gestureFramesRef.current = 0;
    isFaceAnchorSetRef.current = false;
    faceAnalyzerRef.current.reset();
    analyzerRef.current.reset();
  }, [_setState]);

  /** Called when camera is deactivated */
  const onCameraDeactivated = useCallback(() => {
    _stopTimer();
    _setState(GAME_STATE.IDLE);
    setInfractionReason(null);
    poseLostSinceRef.current = null;
    breachFramesRef.current = 0;
    gestureFramesRef.current = 0;
    isFaceAnchorSetRef.current = false;
    faceAnalyzerRef.current.reset();
    analyzerRef.current.reset();
  }, [_setState, _stopTimer]);

  /** Admin / Player presses "Empezar" */
  const startGame = useCallback(() => {
    if (gameStateRef.current !== GAME_STATE.READY) return;
    analyzerRef.current.reset();
    setInfractionReason(null);
    isAnchorSetRef.current = false;
    poseLostSinceRef.current = null;
    breachFramesRef.current = 0;
    gestureFramesRef.current = 0;
    isFaceAnchorSetRef.current = false;
    faceAnalyzerRef.current.reset();

    // Anchor the starting freeze posture if landmarks are already available
    if (latestLandmarksRef.current) {
      analyzerRef.current.setAnchor(latestLandmarksRef.current);
      isAnchorSetRef.current = true;
    }
    if (latestBlendshapesRef.current) {
      faceAnalyzerRef.current.setAnchor(latestBlendshapesRef.current);
      isFaceAnchorSetRef.current = true;
    }
    setGestureDrift(0);

    _startTimer();
    _setState(GAME_STATE.PLAYING);
  }, [_setState, _startTimer]);

  /** End the round with a named reason. Shared by body and face. */
  const _lose = useCallback((reason) => {
    _stopTimer();
    setInfractionReason(reason);
    _setState(GAME_STATE.LOST);
    analyzerRef.current.reset();
    faceAnalyzerRef.current.reset();
  }, [_setState, _stopTimer]);

  /**
   * Called every frame with fresh face blendshapes.
   *
   * Runs on its own stream from the pose landmarker, so it both feeds the
   * live vitality read-out and, during a round, judges facial gestures
   * against the expression anchored at the start.
   */
  const onFaceFrame = useCallback(({ blendshapes, landmarks, now }) => {
    latestBlendshapesRef.current = blendshapes;
    const state = gameStateRef.current;

    const vitals = vitalityRef.current.update({
      blendshapes,
      faceLandmarks: landmarks,
      poseLandmarks: latestLandmarksRef.current,
      now,
    });
    setVitality(vitals);

    if (state !== GAME_STATE.PLAYING) return;

    if (!isFaceAnchorSetRef.current && blendshapes) {
      faceAnalyzerRef.current.setAnchor(blendshapes);
      isFaceAnchorSetRef.current = true;
      blinkCountRef.current = 0;
    }

    const gesture = faceAnalyzerRef.current.update(blendshapes);
    setGestureDrift(gesture.drift);

    // Blinking is counted for display whether or not it costs the round.
    if (vitals.blinkCount !== undefined) blinkCountRef.current = vitals.blinkCount;

    if (penalizeBlinkRef.current && vitals.lastBlinkAgo !== null && vitals.lastBlinkAgo < 120) {
      _lose('Parpadeaste');
      return;
    }

    if (!detectGesturesRef.current || !gesture.isValid) return;

    const { gestureThreshold } = SENSITIVITY_LEVELS[sensitivityRef.current];
    if (gesture.drift > gestureThreshold) {
      gestureFramesRef.current += 1;
      if (gestureFramesRef.current >= GESTURE_CONFIRM_FRAMES) {
        _lose(gesture.reason || 'Gesto facial detectado');
      }
    } else {
      gestureFramesRef.current = 0;
    }
  }, [_lose]);

  /**
   * Called every frame with fresh landmarks (null when no pose was found).
   *
   * Two debounces guard against detector flicker, which would otherwise end
   * a round while the player is perfectly still:
   *  - a dropped pose only counts as leaving the frame after POSE_LOSS_GRACE_MS
   *  - a movement breach must hold for BREACH_CONFIRM_FRAMES consecutive frames
   */
  const onFrame = useCallback((landmarks) => {
    const state = gameStateRef.current;
    const now = performance.now();

    if (landmarks) {
      latestLandmarksRef.current = landmarks;
      poseLostSinceRef.current = null;
    } else if (poseLostSinceRef.current === null) {
      poseLostSinceRef.current = now;
    }
    const poseGapMs = poseLostSinceRef.current === null ? 0 : now - poseLostSinceRef.current;
    const hasPose = poseGapMs < POSE_LOSS_GRACE_MS;

    if (state === GAME_STATE.PLAYING) {
      if (!hasPose) {
        // Pose missing for longer than the grace window: the player really left.
        _lose("La persona salió del encuadre de la cámara.");
        return;
      }

      // Short detection gap: hold the analyzer state and let the timer run.
      if (!landmarks) return;

      // If anchor was not set yet during transition, set it on this first valid frame
      if (!isAnchorSetRef.current) {
        analyzerRef.current.setAnchor(landmarks);
        isAnchorSetRef.current = true;
      }

      const result = analyzerRef.current.update(landmarks);
      const { score, anchorDrift, isValid, reason, anchorReason } = result;

      const currentConfig = SENSITIVITY_LEVELS[sensitivityRef.current];
      const dynamicThreshold = currentConfig.threshold;
      const anchorThreshold = currentConfig.anchorThreshold;

      // Composite HUD meter value: reflects both velocity and static posture drift
      const normalizedDrift = (anchorDrift / anchorThreshold) * dynamicThreshold;
      const displayScore = Math.max(score, normalizedDrift);
      setMovementScore(displayScore);
      setDiagnostics({
        score,
        anchorDrift,
        isValid,
        reason,
        anchorReason,
        zoneScores: result.zoneScores,
        driftScores: result.driftScores,
        validCounts: result.validCounts,
        excludedLandmarks: result.excludedLandmarks,
        bodyScale: result.bodyScale,
        frameCount: result.frameCount,
        breachFrames: breachFramesRef.current,
        dynamicThreshold,
        anchorThreshold,
      });

      if (isValid) {
        const hasDynamicBreach = score > dynamicThreshold;
        const hasAnchorBreach = anchorDrift > anchorThreshold;

        if (hasDynamicBreach || hasAnchorBreach) {
          breachFramesRef.current += 1;

          if (breachFramesRef.current >= BREACH_CONFIRM_FRAMES) {
            const breachReason = hasDynamicBreach ? reason : anchorReason;
            _lose(breachReason || "Movimiento detectado");
          }
        } else {
          breachFramesRef.current = 0;
        }
      }
    } else if (state === GAME_STATE.DETECTING || state === GAME_STATE.READY) {
      // Detection/prep phase: track presence and give live movement feedback
      if (state === GAME_STATE.DETECTING && landmarks) {
        _setState(GAME_STATE.READY);
      } else if (state === GAME_STATE.READY && !hasPose) {
        _setState(GAME_STATE.DETECTING);
        analyzerRef.current.reset();
      }

      if (landmarks) {
        const { score } = analyzerRef.current.update(landmarks);
        setMovementScore(score);
      }
    }
  }, [_setState, _stopTimer]);

  /** Reset for another attempt */
  const reset = useCallback(() => {
    _stopTimer();
    analyzerRef.current.reset();
    isAnchorSetRef.current = false;
    poseLostSinceRef.current = null;
    breachFramesRef.current = 0;
    gestureFramesRef.current = 0;
    isFaceAnchorSetRef.current = false;
    faceAnalyzerRef.current.reset();
    setMovementScore(0);
    setInfractionReason(null);
    timeLeftRef.current = freezeSecondsRef.current;
    setTimeLeft(freezeSecondsRef.current);
    _setState(GAME_STATE.READY);
  }, [_setState, _stopTimer]);

  const backToIdle = useCallback(() => {
    _stopTimer();
    analyzerRef.current.reset();
    isAnchorSetRef.current = false;
    poseLostSinceRef.current = null;
    breachFramesRef.current = 0;
    gestureFramesRef.current = 0;
    isFaceAnchorSetRef.current = false;
    faceAnalyzerRef.current.reset();
    setMovementScore(0);
    setInfractionReason(null);
    _setState(GAME_STATE.IDLE);
  }, [_setState, _stopTimer]);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      _stopTimer();
    };
  }, [_stopTimer]);

  return {
    // State
    gameState,
    timeLeft,
    movementScore,
    infractionReason,
    diagnostics,
    vitality,
    gestureDrift,
    blinkCount: blinkCountRef.current,
    detectGestures,
    setDetectGestures,
    penalizeBlink,
    setPenalizeBlink,
    // Config
    freezeSeconds,
    setFreezeSeconds,
    sensitivity,
    setSensitivity,
    // Actions
    onCameraActivated,
    onCameraDeactivated,
    startGame,
    onFrame,
    onFaceFrame,
    reset,
    backToIdle,
  };
}
