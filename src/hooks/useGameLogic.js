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
  REPLAY_BUFFER_MS,
  REPLAY_FRAME_CAPTURE_EVERY_N_FRAMES,
  REPLAY_SIGNAL_FOCUS,
  ABANDONED_REASON,
} from '../lib/constants.js';
import { DEFAULT_SETTINGS } from '../lib/adminSync.js';
import { playVictorySound, primeAudio } from '../lib/sound.js';

export const GAME_STATE = {
  IDLE: 'IDLE',
  DETECTING: 'DETECTING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  WON: 'WON',
  LOST: 'LOST',
};

/** Zone with the largest anchor drift, for tinting the replay. */
function peakZone(scores) {
  if (!scores) return null;
  let best = null;
  for (const [zone, value] of Object.entries(scores)) {
    if (value > 0 && (best === null || value > scores[best])) best = zone;
  }
  return best;
}

export function useGameLogic() {
  // ── Admin config ────────────────────────────────────────────────────────
  // Set from the separate admin screen (see adminSync.js), never from UI on
  // the game screen. Which detectors are armed: each one that fires gives the
  // player away; turning one off makes the challenge easier for an audience.
  const [freezeSeconds, setFreezeSeconds] = useState(DEFAULT_FREEZE_SECONDS);
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY);
  const [customDynamicThreshold, setCustomDynamicThreshold] = useState(
    SENSITIVITY_LEVELS[DEFAULT_SENSITIVITY].threshold
  );
  const [customAnchorThreshold, setCustomAnchorThreshold] = useState(
    SENSITIVITY_LEVELS[DEFAULT_SENSITIVITY].anchorThreshold
  );
  const [customGestureThreshold, setCustomGestureThreshold] = useState(
    SENSITIVITY_LEVELS[DEFAULT_SENSITIVITY].gestureThreshold
  );
  const [breachConfirmFrames, setBreachConfirmFrames] = useState(BREACH_CONFIRM_FRAMES);
  const [poseLossGraceMs, setPoseLossGraceMs] = useState(POSE_LOSS_GRACE_MS);
  const [detectGestures, setDetectGestures] = useState(DEFAULT_SETTINGS.detectGestures);
  const [detectBlink, setDetectBlink] = useState(DEFAULT_SETTINGS.detectBlink);
  // Blinks tolerated before the player is given away. 0 = none.
  const [blinkBudget, setBlinkBudget] = useState(DEFAULT_SETTINGS.blinkBudget);

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
  // Footage + landmarks of the seconds before a loss, for the result replay.
  const [replayData, setReplayData] = useState(null);

  // ── Internal refs (avoid closure staleness) ─────────────────────────────
  const gameStateRef = useRef(GAME_STATE.IDLE);
  const timerIntervalRef = useRef(null);
  const analyzerRef = useRef(new MovementAnalyzer());
  const previewAnalyzerRef = useRef(new MovementAnalyzer());
  const faceAnalyzerRef = useRef(new FaceGestureAnalyzer());
  const vitalityRef = useRef(new VitalityAnalyzer());
  const freezeSecondsRef = useRef(freezeSeconds);
  const sensitivityRef = useRef(sensitivity);
  const dynamicThresholdRef = useRef(customDynamicThreshold);
  const anchorThresholdRef = useRef(customAnchorThreshold);
  const gestureThresholdRef = useRef(customGestureThreshold);
  const breachConfirmFramesRef = useRef(breachConfirmFrames);
  const poseLossGraceMsRef = useRef(poseLossGraceMs);
  const detectGesturesRef = useRef(detectGestures);
  const detectBlinkRef = useRef(detectBlink);
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

  // Post-game replay: rolling buffer of recent frames (landmarks + an
  // occasional video thumbnail) plus the pose the round started from.
  const replayBufferRef = useRef([]);
  const anchorSnapshotRef = useRef(null);
  const playStartedAtRef = useRef(null);
  const lastFrameImageRef = useRef(null);
  const replayTickRef = useRef(0);

  const _clearReplay = useCallback(() => {
    replayBufferRef.current = [];
    anchorSnapshotRef.current = null;
    playStartedAtRef.current = null;
    lastFrameImageRef.current = null;
    replayTickRef.current = 0;
    setReplayData(null);
  }, []);

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
    dynamicThresholdRef.current = customDynamicThreshold;
  }, [customDynamicThreshold]);

  useEffect(() => {
    anchorThresholdRef.current = customAnchorThreshold;
  }, [customAnchorThreshold]);

  useEffect(() => {
    gestureThresholdRef.current = customGestureThreshold;
  }, [customGestureThreshold]);

  useEffect(() => {
    breachConfirmFramesRef.current = breachConfirmFrames;
  }, [breachConfirmFrames]);

  useEffect(() => {
    poseLossGraceMsRef.current = poseLossGraceMs;
  }, [poseLossGraceMs]);

  useEffect(() => {
    detectGesturesRef.current = detectGestures;
  }, [detectGestures]);

  useEffect(() => {
    blinkBudgetRef.current = blinkBudget;
  }, [blinkBudget]);

  useEffect(() => {
    detectBlinkRef.current = detectBlink;
  }, [detectBlink]);

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
        playVictorySound();
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
    _clearReplay();
  }, [_setState, _clearReplay]);

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
    _clearReplay();
  }, [_setState, _stopTimer, _clearReplay]);

  /** Admin / Player presses "Empezar" */
  const startGame = useCallback(() => {
    if (gameStateRef.current !== GAME_STATE.READY) return;
    // Unlocks the AudioContext inside this click's gesture, since the
    // victory chime itself fires later from an async timer callback.
    primeAudio();
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
    _clearReplay();
    playStartedAtRef.current = performance.now();

    // Anchor the starting freeze posture if landmarks are already available
    if (latestLandmarksRef.current) {
      analyzerRef.current.setAnchor(latestLandmarksRef.current);
      isAnchorSetRef.current = true;
      anchorSnapshotRef.current = latestLandmarksRef.current;
    }
    if (latestBlendshapesRef.current) {
      faceAnalyzerRef.current.setAnchor(latestBlendshapesRef.current);
      isFaceAnchorSetRef.current = true;
    }
    setGestureDrift(0);

    _startTimer();
    _setState(GAME_STATE.PLAYING);
  }, [_setState, _startTimer, _clearReplay]);

  /**
   * The system spotted a sign of life: the round ends and the player loses.
   * Shared by every detector so the reason is always recorded the same way.
   */
  const _detected = useCallback((reason, signal = null, zone = null) => {
    detectedSignalRef.current = signal;
    _stopTimer();
    setInfractionReason(reason);
    setReplayData({
      frames: replayBufferRef.current.slice(),
      anchorLandmarks: anchorSnapshotRef.current,
      activeZone: zone,
      focusIndices: REPLAY_SIGNAL_FOCUS[signal] ?? null,
      survivedMs: playStartedAtRef.current ? performance.now() - playStartedAtRef.current : 0,
    });
    replayBufferRef.current = [];
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

    if (
      state !== GAME_STATE.PLAYING &&
      state !== GAME_STATE.DETECTING &&
      state !== GAME_STATE.READY
    ) {
      return;
    }

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
    // a separate decision (only enforced during PLAYING).
    const roundBlinks = Math.max(0, (vitals.totalBlinks ?? 0) - blinkBaseRef.current);
    blinkCountRef.current = roundBlinks;

    if (state !== GAME_STATE.PLAYING) return;

    // The reason never quotes the tally: the detector can miss a blink, and a
    // number on the result screen reads as a count we are willing to defend.
    const limit = _blinkLimit();
    if (limit !== null && roundBlinks > limit) {
      _detected(
        limit === 0
          ? 'Parpadeaste'
          : 'Parpadeaste más de lo permitido',
        'blink'
      );
      return;
    }

    if (!detectGesturesRef.current || !gesture.isValid) return;

    const gestureThreshold = gestureThresholdRef.current ?? SENSITIVITY_LEVELS[sensitivityRef.current].gestureThreshold;
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
   *  - a dropped pose only counts as leaving the frame after poseLossGraceMs
   *  - a movement breach must hold for breachConfirmFrames consecutive frames
   *
   * `grabFrame` returns a small canvas snapshot of the camera; it is only
   * called during a round, every few frames, to build the loss replay.
   */
  const onFrame = useCallback((landmarks, grabFrame) => {
    const state = gameStateRef.current;
    const now = performance.now();

    if (landmarks) {
      latestLandmarksRef.current = landmarks;
      poseLostSinceRef.current = null;
    } else if (poseLostSinceRef.current === null) {
      poseLostSinceRef.current = now;
    }
    const poseGapMs = poseLostSinceRef.current === null ? 0 : now - poseLostSinceRef.current;
    const hasPose = poseGapMs < poseLossGraceMsRef.current;

    if (state === GAME_STATE.PLAYING) {
      // Keep a rolling window of recent frames for the loss replay, trimmed
      // to REPLAY_BUFFER_MS. Frames between thumbnails reuse the last one.
      replayTickRef.current += 1;
      if (grabFrame && replayTickRef.current % REPLAY_FRAME_CAPTURE_EVERY_N_FRAMES === 1) {
        const image = grabFrame();
        if (image) lastFrameImageRef.current = image;
      }
      replayBufferRef.current.push({ landmarks, t: now, frameImage: lastFrameImageRef.current });
      const cutoff = now - REPLAY_BUFFER_MS;
      while (replayBufferRef.current.length && replayBufferRef.current[0].t < cutoff) {
        replayBufferRef.current.shift();
      }

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
        anchorSnapshotRef.current = landmarks;
      }

      const result = analyzerRef.current.update(landmarks);
      const { score, anchorDrift, isValid, reason, anchorReason } = result;

      const currentConfig = SENSITIVITY_LEVELS[sensitivityRef.current];
      const dynamicThreshold = dynamicThresholdRef.current ?? currentConfig.threshold;
      const anchorThreshold = anchorThresholdRef.current ?? currentConfig.anchorThreshold;
      const confirmFrames = breachConfirmFramesRef.current;

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
        confirmFrames,
        dynamicThreshold,
        anchorThreshold,
      });

      if (isValid) {
        const hasDynamicBreach = score > dynamicThreshold;
        const hasAnchorBreach = anchorDrift > anchorThreshold;

        if (hasDynamicBreach || hasAnchorBreach) {
          breachFramesRef.current += 1;

          if (breachFramesRef.current >= confirmFrames) {
            const breachReason = hasDynamicBreach ? reason : anchorReason;
            const breachZone = hasDynamicBreach ? result.activeZone : peakZone(result.driftScores);
            _detected(breachReason || 'Movimiento detectado', 'movement', breachZone);
          }
        } else {
          breachFramesRef.current = 0;
        }
      }
    } else if (state === GAME_STATE.DETECTING || state === GAME_STATE.READY) {
      // Before "Empezar", verify that a person is present and run the
      // separate preview analyzer so passers-by see live movement telemetry
      // without contaminating the round analyzer (`analyzerRef`).
      if (state === GAME_STATE.DETECTING && landmarks) {
        _setState(GAME_STATE.READY);
      } else if (state === GAME_STATE.READY && !hasPose) {
        _setState(GAME_STATE.DETECTING);
        analyzerRef.current.reset();
        previewAnalyzerRef.current.reset();
        faceAnalyzerRef.current.reset();
        isFaceAnchorSetRef.current = false;
      }
      if (landmarks) {
        const previewResult = previewAnalyzerRef.current.update(landmarks);
        setMovementScore(previewResult.score);
      } else {
        setMovementScore(0);
      }
    }
  }, [_setState, _stopTimer, _detected]);

  /**
   * Player gives up mid-round (the "Salir" button). Closes the round with
   * whatever time was survived so far — not a detection, so it skips the
   * replay and gets neutral copy on the result screen.
   */
  const quitGame = useCallback(() => {
    if (gameStateRef.current !== GAME_STATE.PLAYING) return;
    const survivedMs = playStartedAtRef.current ? performance.now() - playStartedAtRef.current : 0;
    detectedSignalRef.current = null;
    _stopTimer();
    setInfractionReason(ABANDONED_REASON);
    setReplayData({ frames: [], anchorLandmarks: null, activeZone: null, focusIndices: null, survivedMs });
    replayBufferRef.current = [];
    _setState(GAME_STATE.LOST);
    analyzerRef.current.reset();
    faceAnalyzerRef.current.reset();
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
    detectedSignalRef.current = null;
    blinkCountRef.current = 0;
    faceAnalyzerRef.current.reset();
    vitalityRef.current.reset();
    setVitality(null);
    _clearReplay();
    setMovementScore(0);
    setInfractionReason(null);
    timeLeftRef.current = freezeSecondsRef.current;
    setTimeLeft(freezeSecondsRef.current);
    _setState(GAME_STATE.READY);
  }, [_setState, _stopTimer, _clearReplay]);

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
    _clearReplay();
    setMovementScore(0);
    setInfractionReason(null);
    _setState(GAME_STATE.IDLE);
  }, [_setState, _stopTimer, _clearReplay]);

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
    replayData,
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
    detectedSignal: detectedSignalRef.current,
    // Config
    freezeSeconds,
    setFreezeSeconds,
    sensitivity,
    setSensitivity,
    customDynamicThreshold,
    setCustomDynamicThreshold,
    customAnchorThreshold,
    setCustomAnchorThreshold,
    customGestureThreshold,
    setCustomGestureThreshold,
    breachConfirmFrames,
    setBreachConfirmFrames,
    poseLossGraceMs,
    setPoseLossGraceMs,
    // Actions
    onCameraActivated,
    onCameraDeactivated,
    startGame,
    onFrame,
    onFaceFrame,
    reset,
    backToIdle,
    quitGame,
  };
}
