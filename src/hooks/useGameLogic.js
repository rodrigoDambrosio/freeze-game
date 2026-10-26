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
import {
  DEFAULT_FREEZE_SECONDS,
  DEFAULT_SENSITIVITY,
  SENSITIVITY_LEVELS,
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

  // ── Game state ──────────────────────────────────────────────────────────
  const [gameState, setGameState] = useState(GAME_STATE.IDLE);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_FREEZE_SECONDS);
  const [movementScore, setMovementScore] = useState(0);
  const [infractionReason, setInfractionReason] = useState(null);

  // ── Internal refs (avoid closure staleness) ─────────────────────────────
  const gameStateRef = useRef(GAME_STATE.IDLE);
  const timerIntervalRef = useRef(null);
  const analyzerRef = useRef(new MovementAnalyzer());
  const freezeSecondsRef = useRef(freezeSeconds);
  const sensitivityRef = useRef(sensitivity);
  const timeLeftRef = useRef(freezeSeconds);
  const latestLandmarksRef = useRef(null);
  const isAnchorSetRef = useRef(false);

  // Keep refs in sync
  useEffect(() => {
    freezeSecondsRef.current = freezeSeconds;
    timeLeftRef.current = freezeSeconds;
    setTimeLeft(freezeSeconds);
  }, [freezeSeconds]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

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
    analyzerRef.current.reset();
  }, [_setState]);

  /** Called when camera is deactivated */
  const onCameraDeactivated = useCallback(() => {
    _stopTimer();
    _setState(GAME_STATE.IDLE);
    setInfractionReason(null);
    analyzerRef.current.reset();
  }, [_setState, _stopTimer]);

  /** Called when pose is detected/lost — transitions DETECTING ↔ READY */
  const onPoseDetected = useCallback((hasValidPose) => {
    const state = gameStateRef.current;
    if (state === GAME_STATE.DETECTING && hasValidPose) {
      _setState(GAME_STATE.READY);
    } else if (state === GAME_STATE.READY && !hasValidPose) {
      _setState(GAME_STATE.DETECTING);
      analyzerRef.current.reset();
    }
  }, [_setState]);

  /** Admin / Player presses "Empezar" */
  const startGame = useCallback(() => {
    if (gameStateRef.current !== GAME_STATE.READY) return;
    analyzerRef.current.reset();
    setInfractionReason(null);
    isAnchorSetRef.current = false;

    // Anchor the starting freeze posture if landmarks are already available
    if (latestLandmarksRef.current) {
      analyzerRef.current.setAnchor(latestLandmarksRef.current);
      isAnchorSetRef.current = true;
    }

    _startTimer();
    _setState(GAME_STATE.PLAYING);
  }, [_setState, _startTimer]);

  /** Called every frame with fresh landmarks */
  const onFrame = useCallback((landmarks) => {
    latestLandmarksRef.current = landmarks;
    const state = gameStateRef.current;

    if (state === GAME_STATE.PLAYING) {
      if (!landmarks) {
        // Player completely left the frame
        _stopTimer();
        setInfractionReason('La persona salió del encuadre de la cámara.');
        _setState(GAME_STATE.LOST);
        analyzerRef.current.reset();
        return;
      }

      // If anchor wasn't set yet during transition, set it on this first valid frame
      if (!isAnchorSetRef.current) {
        analyzerRef.current.setAnchor(landmarks);
        isAnchorSetRef.current = true;
      }

      const { score, anchorDrift, isValid, reason, anchorReason } = analyzerRef.current.update(landmarks);

      const currentConfig = SENSITIVITY_LEVELS[sensitivityRef.current];
      const dynamicThreshold = currentConfig.threshold;
      const anchorThreshold = currentConfig.anchorThreshold;

      // Composite HUD meter value: reflects both velocity and static posture drift
      const normalizedDrift = (anchorDrift / anchorThreshold) * dynamicThreshold;
      const displayScore = Math.max(score, normalizedDrift);
      setMovementScore(displayScore);

      if (isValid) {
        const hasDynamicBreach = score > dynamicThreshold;
        const hasAnchorBreach = anchorDrift > anchorThreshold;

        if (hasDynamicBreach || hasAnchorBreach) {
          _stopTimer();
          const breachReason = hasDynamicBreach ? reason : anchorReason;
          setInfractionReason(breachReason || 'Movimiento detectado');
          _setState(GAME_STATE.LOST);
          analyzerRef.current.reset();
        }
      }
    } else if (state === GAME_STATE.DETECTING || state === GAME_STATE.READY) {
      // Detection/prep phase: provide live movement feedback
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
    // Config
    freezeSeconds,
    setFreezeSeconds,
    sensitivity,
    setSensitivity,
    // Actions
    onCameraActivated,
    onCameraDeactivated,
    onPoseDetected,
    startGame,
    onFrame,
    reset,
    backToIdle,
  };
}
