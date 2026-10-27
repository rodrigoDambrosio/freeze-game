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
  // Which detectors are armed. Each one that fires gives the player away;
  // turning one off makes the challenge easier for a given audience.
  const [detectGestures, setDetectGestures] = useState(true);
  const [detectBlink, setDetectBlink] = useState(true);
  // Breathing is shown in the monitor, but penalising it by default would
  // make a normal human unable to win a presentation game.
  const [detectBreathing, setDetectBreathing] = useState(false);
  // Blinks tolerated before the player is given away. 0 = none.
  // Allow a few involuntary blinks during the default 20-second round.
  const [blinkBudget, setBlinkBudget] = useState(3);

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
  const detectBlinkRef = useRef(detectBlink);
  const detectBreathingRef = useRef(detectBreathing);
  const blinkBudgetRef = useRef(blinkBudget);
  // Blink tally captured when the round starts, so only this round counts.
  const blinkBaseRef = useRef(0);
  const detectedSignalRef = useRef(null);
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
    blinkBudgetRef.current = blinkBudget;
  }, [blinkBudget]);

  useEffect(() => {
    detectBlinkRef.current = detectBlink;
  }, [detectBlink]);

  useEffect(() => {
    detectBreathingRef.current = detectBreathing;
  }, [detectBreathing]);

  /** Blinks tolerated this round, or null when blinking is not watched. */
  const _blinkLimit = useCallback(() => {
    if (!detectBlinkRef.current) return null;
    const configured = blinkBudgetRef.current;
    if (configured === null || configured === undefined) return null;
    return Math.max(0, configured);
  }, []);

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
    detectedSignalRef.current = null;
    blinkCountRef.current = 0;
    faceAnalyzerRef.current.reset();
    analyzerRef.current.reset();
    vitalityRef.current.reset();
    setVitality(null);
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
    detectedSignalRef.current = null;
    blinkCountRef.current = 0;
    faceAnalyzerRef.current.reset();
    analyzerRef.current.reset();
    vitalityRef.current.reset();
    setVitality(null);
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
    detectedSignalRef.current = null;
    blinkCountRef.current = 0;
    faceAnalyzerRef.current.reset();
    vitalityRef.current.reset();
    setVitality(null);

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

  /**
   * The system spotted a sign of life: the round ends and the player loses.
   * Shared by every detector so the reason is always recorded the same way.
   */
  const _detected = useCallback((reason, signal = null) => {
    detectedSignalRef.current = signal;
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

    // Face inference may run to keep the camera preview responsive, but the
    // game detector is disarmed until the player presses "Empezar". In
    // particular, do not let pre-round blinks or expressions contaminate the
    // round baseline.
    if (state !== GAME_STATE.PLAYING) return;

    const vitals = vitalityRef.current.update({
      blendshapes,
      faceLandmarks: landmarks,
      poseLandmarks: latestLandmarksRef.current,
      now,
    });
    setVitality(vitals);

    if (!isFaceAnchorSetRef.current && blendshapes) {
      faceAnalyzerRef.current.setAnchor(blendshapes);
      isFaceAnchorSetRef.current = true;
      blinkBaseRef.current = vitals.totalBlinks ?? 0;
      blinkCountRef.current = 0;
    }

    const gesture = faceAnalyzerRef.current.update(blendshapes);
    setGestureDrift(gesture.drift);

    // Blinks are always counted and shown; whether they cost the round is
    // a separate decision.
    const roundBlinks = Math.max(0, (vitals.totalBlinks ?? 0) - blinkBaseRef.current);
    blinkCountRef.current = roundBlinks;

    const limit = _blinkLimit();
    if (limit !== null && roundBlinks > limit) {
      _detected(
        limit === 0
          ? 'Parpadeaste'
          : `Parpadeaste ${roundBlinks} veces`,
        'blink'
      );
      return;
    }

    // Breathing is the hardest sign to suppress and the one the system is
    // proudest of. Presence answers in about one cycle; the rate, once the
    // long window has filled, names the number out loud.
    if (detectBreathingRef.current && vitals.breathingDetected) {
      const detail = vitals.rateKnown
        ? `Respiración detectada (${vitals.breathingRate.toFixed(0)}/min)`
        : 'Respiración detectada';
      _detected(detail, 'breathing');
      return;
    }

    if (!detectGesturesRef.current || !gesture.isValid) return;

    const { gestureThreshold } = SENSITIVITY_LEVELS[sensitivityRef.current];
    if (gesture.drift > gestureThreshold) {
      gestureFramesRef.current += 1;
      if (gestureFramesRef.current >= GESTURE_CONFIRM_FRAMES) {
        _detected(gesture.reason || 'Gesto facial detectado', 'gesture');
      }
    } else {
      gestureFramesRef.current = 0;
    }
  }, [_detected, _blinkLimit]);

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
        _detected('La persona salió del encuadre de la cámara.', 'absent');
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
            _detected(breachReason || 'Movimiento detectado', 'movement');
          }
        } else {
          breachFramesRef.current = 0;
        }
      }
    } else if (state === GAME_STATE.DETECTING || state === GAME_STATE.READY) {
      // Before "Empezar", only verify that a person is present. Do not feed
      // the movement analyzer: its history and calibration belong to a round.
      if (state === GAME_STATE.DETECTING && landmarks) {
        _setState(GAME_STATE.READY);
      } else if (state === GAME_STATE.READY && !hasPose) {
        _setState(GAME_STATE.DETECTING);
        analyzerRef.current.reset();
      }
      setMovementScore(0);
    }
  }, [_setState, _stopTimer, _detected]);

  /** Reset for another attempt */
  const reset = useCallback(() => {
    _stopTimer();
    analyzerRef.current.reset();
    isAnchorSetRef.current = false;
    poseLostSinceRef.current = null;
    breachFramesRef.current = 0;
    gestureFramesRef.current = 0;
    isFaceAnchorSetRef.current = false;
    detectedSignalRef.current = null;
    blinkCountRef.current = 0;
    faceAnalyzerRef.current.reset();
    vitalityRef.current.reset();
    setVitality(null);
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
    detectedSignalRef.current = null;
    blinkCountRef.current = 0;
    faceAnalyzerRef.current.reset();
    vitalityRef.current.reset();
    setVitality(null);
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
    blinkBudget,
    setBlinkBudget,
    blinkLimit: _blinkLimit(),
    detectBlink,
    setDetectBlink,
    detectBreathing,
    setDetectBreathing,
    detectedSignal: detectedSignalRef.current,
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
