/**
 * useSimonSaysLogic.js
 *
 * State machine for the "Simón Dice" game mode.
 * States: IDLE → DETECTING → READY → PLAYING → FINISHED
 *
 * Evaluates both body postures (pose landmarks) and facial expressions / eye
 * gestures (face blendshapes) so everything detected in the Freeze Challenge
 * can also be played in Simón Dice.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  SIMON_PRESETS,
  DEFAULT_SIMON_PRESET,
  SIMON_POSE_CONFIRM_FRAMES,
  SIMON_BASE_POINTS,
  SIMON_SPEED_BONUS_TIERS,
  DEFAULT_STICKER_THRESHOLD,
  DEFAULT_PEN_THRESHOLD,
} from '../lib/constants.js';
import {
  generateCommandSequence,
  pickPoseFallbackCommand,
  isCommandEnabled,
} from '../lib/simonCommands.js';
import { speak, cancelSpeech, primeSpeech } from '../lib/speech.js';
import { playVictorySound, primeAudio } from '../lib/sound.js';

export const SIMON_STATE = {
  IDLE: 'IDLE',
  DETECTING: 'DETECTING',
  READY: 'READY',
  PLAYING: 'PLAYING',
  FINISHED: 'FINISHED',
};

const FACE_RECENT_WINDOW_MS = 2500;

function speedBonus(elapsedMs) {
  const elapsedSeconds = elapsedMs / 1000;
  for (const tier of SIMON_SPEED_BONUS_TIERS) {
    if (elapsedSeconds <= tier.maxSeconds) return tier.bonus;
  }
  return 0;
}

export function useSimonSaysLogic() {
  // ── Admin config ────────────────────────────────────────────────────────
  const [preset, setPreset] = useState(DEFAULT_SIMON_PRESET);
  const [commandCountConfig, setCommandCountConfig] = useState(SIMON_PRESETS[DEFAULT_SIMON_PRESET].commandCount);
  const [commandSecondsConfig, setCommandSecondsConfig] = useState(SIMON_PRESETS[DEFAULT_SIMON_PRESET].commandSeconds);
  const [confirmFramesConfig, setConfirmFramesConfig] = useState(SIMON_POSE_CONFIRM_FRAMES);
  const [stickerThreshold, setStickerThreshold] = useState(DEFAULT_STICKER_THRESHOLD);
  const [penThreshold, setPenThreshold] = useState(DEFAULT_PEN_THRESHOLD);

  // ── Game state ──────────────────────────────────────────────────────────
  const [simonState, setSimonState] = useState(SIMON_STATE.IDLE);
  const [currentCommand, setCurrentCommand] = useState(null);
  const [commandIndex, setCommandIndex] = useState(0);
  const [totalCommands, setTotalCommands] = useState(SIMON_PRESETS[DEFAULT_SIMON_PRESET].commandCount);
  const [timeLeftInCommand, setTimeLeftInCommand] = useState(SIMON_PRESETS[DEFAULT_SIMON_PRESET].commandSeconds);
  const [score, setScore] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [lastCommandResult, setLastCommandResult] = useState(null);
  const [rewardUnlocked, setRewardUnlocked] = useState(null);
  const [abandoned, setAbandoned] = useState(false);
  const [isHolding, setIsHolding] = useState(false);

  // ── Internal refs ───────────────────────────────────────────────────────
  const simonStateRef = useRef(SIMON_STATE.IDLE);
  const presetRef = useRef(preset);
  const commandCountRef = useRef(commandCountConfig);
  const commandSecondsRef = useRef(commandSecondsConfig);
  const confirmFramesRef = useRef(confirmFramesConfig);
  const stickerThresholdRef = useRef(stickerThreshold);
  const penThresholdRef = useRef(penThreshold);
  const commandsRef = useRef([]);
  const commandIndexRef = useRef(0);
  const scoreRef = useRef(0);
  const completedCountRef = useRef(0);
  const holdFramesRef = useRef(0);
  const isHoldingRef = useRef(false);
  const commandStartAtRef = useRef(0);
  const commandTimerRef = useRef(null);
  const resultKeyRef = useRef(0);
  const latestBlendshapesRef = useRef(null);
  const lastFaceSeenAtRef = useRef(-Infinity);

  useEffect(() => { presetRef.current = preset; }, [preset]);
  useEffect(() => { commandCountRef.current = commandCountConfig; }, [commandCountConfig]);
  useEffect(() => { commandSecondsRef.current = commandSecondsConfig; }, [commandSecondsConfig]);
  useEffect(() => { confirmFramesRef.current = confirmFramesConfig; }, [confirmFramesConfig]);
  useEffect(() => { stickerThresholdRef.current = stickerThreshold; }, [stickerThreshold]);
  useEffect(() => { penThresholdRef.current = penThreshold; }, [penThreshold]);

  const _setState = useCallback((s) => {
    simonStateRef.current = s;
    setSimonState(s);
  }, []);

  const _stopCommandTimer = useCallback(() => {
    if (commandTimerRef.current) {
      clearInterval(commandTimerRef.current);
      commandTimerRef.current = null;
    }
  }, []);

  const _rewardFor = useCallback((finalScore) => {
    if (finalScore >= penThresholdRef.current) return 'pen';
    if (finalScore >= stickerThresholdRef.current) return 'sticker';
    return null;
  }, []);

  const _finish = useCallback((wasAbandoned) => {
    _stopCommandTimer();
    cancelSpeech();
    const reward = _rewardFor(scoreRef.current);
    setAbandoned(wasAbandoned);
    setRewardUnlocked(reward);
    if (reward) playVictorySound();
    _setState(SIMON_STATE.FINISHED);
  }, [_stopCommandTimer, _rewardFor, _setState]);

  const startCommandTimerRef = useRef(() => {});

  /** Moves to the next command, or finishes the round if that was the last one. */
  const _advanceCommand = useCallback((success, points) => {
    resultKeyRef.current += 1;
    setLastCommandResult({ key: resultKeyRef.current, success, points });
    holdFramesRef.current = 0;
    isHoldingRef.current = false;
    setIsHolding(false);

    const nextIndex = commandIndexRef.current + 1;
    if (nextIndex >= commandsRef.current.length) {
      _finish(false);
      return;
    }
    commandIndexRef.current = nextIndex;
    setCommandIndex(nextIndex);

    let nextCommand = commandsRef.current[nextIndex];
    const hasRecentFace = performance.now() - lastFaceSeenAtRef.current <= FACE_RECENT_WINDOW_MS;
    if ((nextCommand?.requiresFace && !hasRecentFace) || (nextCommand && !isCommandEnabled(nextCommand.id))) {
      const prevId = commandsRef.current[nextIndex - 1]?.id;
      nextCommand = pickPoseFallbackCommand(prevId);
      commandsRef.current[nextIndex] = nextCommand;
    }

    setCurrentCommand(nextCommand);
    speak(nextCommand.label);
    commandStartAtRef.current = performance.now();
    startCommandTimerRef.current();
  }, [_finish]);

  const _startCommandTimer = useCallback(() => {
    _stopCommandTimer();
    const seconds = commandSecondsRef.current;
    setTimeLeftInCommand(seconds);
    commandTimerRef.current = setInterval(() => {
      setTimeLeftInCommand((t) => Math.max(0, +(t - 1).toFixed(1)));
    }, 1000);
  }, [_stopCommandTimer]);

  useEffect(() => {
    startCommandTimerRef.current = _startCommandTimer;
  }, [_startCommandTimer]);

  // ── Public game actions ─────────────────────────────────────────────────

  const onCameraActivated = useCallback(() => {
    _setState(SIMON_STATE.DETECTING);
  }, [_setState]);

  const onCameraDeactivated = useCallback(() => {
    _stopCommandTimer();
    cancelSpeech();
    latestBlendshapesRef.current = null;
    _setState(SIMON_STATE.IDLE);
  }, [_stopCommandTimer, _setState]);

  const startGame = useCallback(() => {
    if (simonStateRef.current !== SIMON_STATE.READY) return;
    primeAudio();
    primeSpeech();
    const count = commandCountRef.current;
    const hasRecentFace = performance.now() - lastFaceSeenAtRef.current <= FACE_RECENT_WINDOW_MS;
    commandsRef.current = generateCommandSequence(count, { includeFace: hasRecentFace });
    commandIndexRef.current = 0;
    scoreRef.current = 0;
    completedCountRef.current = 0;
    holdFramesRef.current = 0;
    isHoldingRef.current = false;

    setTotalCommands(count);
    setCommandIndex(0);
    setCurrentCommand(commandsRef.current[0]);
    speak(commandsRef.current[0].label);
    setScore(0);
    setCompletedCount(0);
    setLastCommandResult(null);
    setRewardUnlocked(null);
    setAbandoned(false);
    setIsHolding(false);

    commandStartAtRef.current = performance.now();
    _startCommandTimer();
    _setState(SIMON_STATE.PLAYING);
  }, [_setState, _startCommandTimer]);

  /** Called every face frame with fresh blendshapes. */
  const onFaceFrame = useCallback(({ blendshapes, now = performance.now() } = {}) => {
    if (blendshapes && blendshapes.length > 0) {
      latestBlendshapesRef.current = blendshapes;
      lastFaceSeenAtRef.current = now;
    } else {
      latestBlendshapesRef.current = null;
    }
  }, []);

  /** Called every frame with fresh pose landmarks (null when no pose was found). */
  const onFrame = useCallback((landmarks) => {
    const state = simonStateRef.current;

    if (state === SIMON_STATE.PLAYING) {
      const command = commandsRef.current[commandIndexRef.current];
      const now = performance.now();
      const activeBlendshapes =
        now - lastFaceSeenAtRef.current <= FACE_RECENT_WINDOW_MS
          ? latestBlendshapesRef.current
          : null;
      const matched = !!(command && command.classifier(landmarks, activeBlendshapes));

      if (matched !== isHoldingRef.current) {
        isHoldingRef.current = matched;
        setIsHolding(matched);
      }

      if (matched) {
        holdFramesRef.current += 1;
        if (holdFramesRef.current >= confirmFramesRef.current) {
          const elapsedMs = now - commandStartAtRef.current;
          const points = SIMON_BASE_POINTS + speedBonus(elapsedMs);
          scoreRef.current += points;
          completedCountRef.current += 1;
          setScore(scoreRef.current);
          setCompletedCount(completedCountRef.current);
          _advanceCommand(true, points);
          return;
        }
      } else {
        holdFramesRef.current = 0;
      }

      const seconds = commandSecondsRef.current;
      if (now - commandStartAtRef.current >= seconds * 1000) {
        _advanceCommand(false, 0);
      }
    } else if (state === SIMON_STATE.DETECTING || state === SIMON_STATE.READY) {
      if (state === SIMON_STATE.DETECTING && landmarks) {
        _setState(SIMON_STATE.READY);
      } else if (state === SIMON_STATE.READY && !landmarks) {
        _setState(SIMON_STATE.DETECTING);
      }
    }
  }, [_setState, _advanceCommand]);

  /** Player gives up mid-round: close with whatever was scored so far. */
  const quitGame = useCallback(() => {
    if (simonStateRef.current !== SIMON_STATE.PLAYING) return;
    _finish(true);
  }, [_finish]);

  const backToIdle = useCallback(() => {
    _stopCommandTimer();
    cancelSpeech();
    latestBlendshapesRef.current = null;
    _setState(SIMON_STATE.IDLE);
  }, [_stopCommandTimer, _setState]);

  useEffect(() => () => _stopCommandTimer(), [_stopCommandTimer]);

  return {
    // State
    simonState,
    currentCommand,
    commandIndex,
    totalCommands,
    timeLeftInCommand,
    commandSeconds: commandSecondsConfig,
    score,
    completedCount,
    isHolding,
    lastCommandResult,
    rewardUnlocked,
    abandoned,
    stickerThreshold,
    penThreshold,
    // Config
    preset,
    setPreset,
    setCommandCountConfig,
    setCommandSecondsConfig,
    setConfirmFramesConfig,
    setStickerThreshold,
    setPenThreshold,
    // Actions
    onCameraActivated,
    onCameraDeactivated,
    startGame,
    onFrame,
    onFaceFrame,
    quitGame,
    backToIdle,
  };
}
