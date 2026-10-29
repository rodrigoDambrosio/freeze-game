import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCamera } from './hooks/useCamera.js';
import { usePoseDetection } from './hooks/usePoseDetection.js';
import { useGameLogic, GAME_STATE } from './hooks/useGameLogic.js';
import { useSimonSaysLogic, SIMON_STATE } from './hooks/useSimonSaysLogic.js';
import { useAmbientObservations } from './hooks/useAmbientObservations.js';
import { SENSITIVITY_LEVELS, REPLAY_FRAME_WIDTH } from './lib/constants.js';
import { setPoseRuntimeConfig } from './lib/poseAnalyzer.js';
import { setSimonPoseMargins } from './lib/simonPoseClassifiers.js';
import { setDisabledCommands } from './lib/simonCommands.js';
import { setAmbientRuntimeConfig } from './lib/ambientSignals.js';
import {
  readSettings,
  subscribeSettings,
  writeTelemetry,
  TELEMETRY_MIN_INTERVAL_MS,
  TELEMETRY_STALE_MS,
} from './lib/adminSync.js';
import Header from './components/Header.jsx';
import CameraView from './components/CameraView.jsx';
import Timer from './components/Timer.jsx';
import ResultScreen from './components/ResultScreen.jsx';
import SimonResultScreen from './components/SimonResultScreen.jsx';
import SimonCommandPanel from './components/SimonCommandPanel.jsx';
import IdleAttractScreen from './components/IdleAttractScreen.jsx';
import QuitButton from './components/QuitButton.jsx';
import DiagnosticPanel from './components/DiagnosticPanel.jsx';
import VitalityMonitor from './components/VitalityMonitor.jsx';
import { useFaceDetection } from './hooks/useFaceDetection.js';
import './App.css';

/**
 * Small snapshot of the current camera frame for the loss replay. Stays in an
 * in-memory canvas for this tab only; never stored or sent.
 */
function grabVideoFrame(video) {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = REPLAY_FRAME_WIDTH;
    canvas.height = Math.round(REPLAY_FRAME_WIDTH * (video.videoHeight / video.videoWidth));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch {
    return null;
  }
}

export default function App() {
  const [diagOpen, setDiagOpen] = useState(false);

  const [theme, setTheme] = useState(() =>
    localStorage.getItem('cuida-theme') || 'dark'
  );
  // Visible-video rect reported by CameraView — confines the HUD (badge,
  // timer, buttons) to the actual camera image, never the letterbox bars.
  const [stageInset, setStageInset] = useState({ top: 0, right: 0, bottom: 0, left: 0 });

  const [initialSettings] = useState(() => readSettings());
  const [gameMode, setGameMode] = useState(initialSettings.gameMode);
  const [minPoseConfidence, setMinPoseConfidence] = useState(initialSettings.minPoseConfidence);
  const [inferenceDelegate, setInferenceDelegate] = useState(initialSettings.inferenceDelegate);
  const [poseModelVariant, setPoseModelVariant] = useState(initialSettings.poseModelVariant);
  const [showAmbientTag, setShowAmbientTag] = useState(initialSettings.showAmbientTag);
  const [videoConfig, setVideoConfig] = useState(() => ({
    videoSourceType: initialSettings.videoSourceType,
    videoDeviceId: initialSettings.videoDeviceId,
    videoSourceUrl: initialSettings.videoSourceUrl,
    httpStreamMode: initialSettings.httpStreamMode,
    useCameraProxy: initialSettings.useCameraProxy,
    videoFileName: initialSettings.videoFileName,
    videoFileUpdatedAt: initialSettings.videoFileUpdatedAt,
    videoLoop: initialSettings.videoLoop,
    mirrorVideo: initialSettings.mirrorVideo,
  }));

  const isSimon = gameMode === 'simon';

  const camera = useCamera(videoConfig);
  const game = useGameLogic();
  const simon = useSimonSaysLogic();
  const ambient = useAmbientObservations();
  const pose = usePoseDetection(
    camera.videoRef,
    null,
    camera.isReady,
    minPoseConfidence,
    inferenceDelegate,
    poseModelVariant,
  );
  const lastTelemetryAtRef = useRef(0);

  // ── Derived state (used below and by the telemetry effect) ──────────────
  const isPlaying = isSimon
    ? simon.simonState === SIMON_STATE.PLAYING
    : game.gameState === GAME_STATE.PLAYING;
  const isDetecting = isSimon
    ? simon.simonState === SIMON_STATE.DETECTING
    : game.gameState === GAME_STATE.DETECTING;
  const isReady = isSimon
    ? simon.simonState === SIMON_STATE.READY
    : game.gameState === GAME_STATE.READY;
  const isResult = isSimon
    ? simon.simonState === SIMON_STATE.FINISHED
    : game.gameState === GAME_STATE.WON || game.gameState === GAME_STATE.LOST;
  const activeGameState = isSimon ? simon.simonState : game.gameState;
  const showCamera = isSimon
    ? simon.simonState !== SIMON_STATE.IDLE
    : [GAME_STATE.DETECTING, GAME_STATE.READY, GAME_STATE.PLAYING, GAME_STATE.WON, GAME_STATE.LOST].includes(game.gameState);
  const isRoundActive = isPlaying || isResult;

  // Keep the facial detector active whenever the camera is open and not on the
  // result screen: feeds Freeze round detectors, Simón Dice facial commands,
  // and the pre-game live sensors / passer-by observations.
  const faceEnabled = camera.isReady && !isResult;
  const face = useFaceDetection(camera.videoRef, camera.isReady, faceEnabled, inferenceDelegate);

  // ── Admin settings arrive from the separate admin tab/window (#admin),
  // never from UI on this participant-facing screen ─────────────────────────
  useEffect(() => {
    const apply = (settings) => {
      setGameMode(settings.gameMode);
      setMinPoseConfidence(settings.minPoseConfidence);
      setInferenceDelegate(settings.inferenceDelegate);
      setPoseModelVariant(settings.poseModelVariant);
      setShowAmbientTag(settings.showAmbientTag);

      setVideoConfig({
        videoSourceType: settings.videoSourceType,
        videoDeviceId: settings.videoDeviceId,
        videoSourceUrl: settings.videoSourceUrl,
        httpStreamMode: settings.httpStreamMode,
        useCameraProxy: settings.useCameraProxy,
        videoFileName: settings.videoFileName,
        videoFileUpdatedAt: settings.videoFileUpdatedAt,
        videoLoop: settings.videoLoop,
        mirrorVideo: settings.mirrorVideo,
      });

      setPoseRuntimeConfig({
        minLandmarkVisibility: settings.minLandmarkVisibility,
        poseSmoothing: settings.poseSmoothing,
        occlusionDamping: settings.occlusionDamping,
        occlusionHoldMs: settings.occlusionHoldMs,
        hideNoisyExtremities: settings.hideNoisyExtremities,
        zoneWeights: {
          head: settings.zoneWeightHead,
          torso: settings.zoneWeightTorso,
          arms: settings.zoneWeightArms,
          legs: settings.zoneWeightLegs,
        },
      });

      setSimonPoseMargins({
        armsUpMargin: settings.simonArmsUpMargin,
        armsDownMargin: settings.simonArmsDownMargin,
        touchMargin: settings.simonTouchMargin,
      });
      setDisabledCommands(settings.disabledCommands);
      setAmbientRuntimeConfig({
        disabledSignals: settings.disabledAmbientSignals,
        showMotion: settings.showAmbientMotion,
      });

      game.setFreezeSeconds(settings.freezeSeconds);
      game.setSensitivity(settings.sensitivity);
      game.setCustomDynamicThreshold(settings.customDynamicThreshold);
      game.setCustomAnchorThreshold(settings.customAnchorThreshold);
      game.setCustomGestureThreshold(settings.customGestureThreshold);
      game.setBreachConfirmFrames(settings.breachConfirmFrames);
      game.setPoseLossGraceMs(settings.poseLossGraceMs);
      game.setDetectGestures(settings.detectGestures);
      game.setDetectBlink(settings.detectBlink);
      game.setBlinkBudget(settings.blinkBudget);

      simon.setPreset(settings.simonPreset);
      simon.setCommandCountConfig(settings.simonCommandCount);
      simon.setCommandSecondsConfig(settings.simonCommandSeconds);
      simon.setConfirmFramesConfig(settings.simonConfirmFrames);
      simon.setStickerThreshold(settings.simonStickerThreshold);
      simon.setPenThreshold(settings.simonPenThreshold);
    };
    apply(readSettings());
    return subscribeSettings(apply);
  }, []); // eslint-disable-line

  // ── Report live state back to the admin tab ──────────────────────────────
  // Throttled while the meter moves, written at once on a state change, and
  // re-sent as a heartbeat so an idle game screen still reads as connected.
  const telemetryRef = useRef(null);
  useEffect(() => {
    const prevState = telemetryRef.current?.gameState;
    const baseTelemetry = {
      gameMode,
      cameraReady: camera.isReady,
      sourceLabel: camera.sourceLabel,
      cameraError: camera.error,
      activeDelegate: pose.activeDelegate,
      activeModelVariant: pose.activeModelVariant,
      gpuRenderer: pose.gpuRenderer,
      inferenceFps: pose.inferenceFps,
      inferenceMs: pose.inferenceMs,
    };
    telemetryRef.current = isSimon
      ? {
        ...baseTelemetry,
        gameState: simon.simonState,
        hasLiveReading: isPlaying,
        currentCommandLabel: simon.currentCommand?.label ?? null,
        commandIndex: simon.commandIndex,
        totalCommands: simon.totalCommands,
        score: simon.score,
        timeLeftInCommand: simon.timeLeftInCommand,
      }
      : {
        ...baseTelemetry,
        movementScore: game.movementScore,
        hasLiveReading: isPlaying,
        gameState: game.gameState,
      };
    const now = performance.now();
    if (prevState === activeGameState && now - lastTelemetryAtRef.current < TELEMETRY_MIN_INTERVAL_MS) return;
    lastTelemetryAtRef.current = now;
    writeTelemetry(telemetryRef.current);
  }, [
    isSimon, gameMode, isPlaying, activeGameState,
    camera.isReady, camera.sourceLabel, camera.error,
    pose.activeDelegate, pose.activeModelVariant, pose.gpuRenderer, pose.inferenceFps, pose.inferenceMs,
    game.movementScore, game.gameState,
    simon.simonState, simon.currentCommand, simon.commandIndex, simon.totalCommands, simon.score, simon.timeLeftInCommand,
  ]);

  useEffect(() => {
    const id = setInterval(() => {
      if (telemetryRef.current) writeTelemetry(telemetryRef.current);
    }, TELEMETRY_STALE_MS / 2);
    return () => clearInterval(id);
  }, []);

  // ── Persist theme ─────────────────────────────────────────────────────────
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('cuida-theme', next);
      return next;
    });
  }, []);

  // ── Wire pose detections → game logic ────────────────────────────────────
  const { onFrameRef } = pose;
  const onGameFrame = game.onFrame;
  const onSimonFrame = simon.onFrame;
  const onAmbientFrame = ambient.onFrame;
  useEffect(() => {
    onFrameRef.current = (lms, video) => {
      try {
        if (isSimon) {
          onSimonFrame(lms);
          if (!isRoundActive) {
            onGameFrame(lms);
          }
        } else {
          onGameFrame(lms, () => grabVideoFrame(video));
        }
      } catch (err) {
        console.error('[Simón Dice] error en onFrame:', err);
      }

      if (!isRoundActive) {
        try {
          onAmbientFrame(lms);
        } catch (err) {
          console.error('[Simón Dice] error en el detector ambiental:', err);
        }
      }
    };
    return () => {
      onFrameRef.current = null;
    };
  }, [onFrameRef, isSimon, onGameFrame, onSimonFrame, onAmbientFrame, isRoundActive]);

  // Face stream carries blinking, expression and the gesture judgement for
  // the freeze game's own round, facial commands for Simón Dice, and live
  // sensors / passer-by observations while waiting to start.
  const faceFrameRef = face.onFrameRef;
  const onGameFace = game.onFaceFrame;
  const onSimonFace = simon.onFaceFrame;
  const onAmbientFace = ambient.onFaceFrame;
  useEffect(() => {
    faceFrameRef.current = (frame) => {
      try {
        if (isSimon) {
          onSimonFace(frame);
        }
        if (!isSimon || !isRoundActive) {
          onGameFace(frame);
        }
      } catch (err) {
        console.error('[Simón Dice] error en onFaceFrame:', err);
      }

      if (!isRoundActive) {
        try {
          onAmbientFace(frame);
        } catch (err) {
          console.error('[Simón Dice] error en el detector ambiental facial:', err);
        }
      }
    };
    return () => {
      faceFrameRef.current = null;
    };
  }, [faceFrameRef, isSimon, isRoundActive, onGameFace, onSimonFace, onAmbientFace]);

  // ── Diagnostics overlay (D) ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'd' && e.key !== 'D') return;
      if (e.target.closest?.('input, textarea, select')) return;
      setDiagOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Camera activation callbacks ──────────────────────────────────────────
  const handleActivateCamera = useCallback(async () => {
    game.onCameraActivated();
    simon.onCameraActivated();
    await camera.startCamera();
  }, [camera, game, simon]);

  const handleDeactivateCamera = useCallback(() => {
    camera.stopCamera();
    game.onCameraDeactivated();
    simon.onCameraDeactivated();
  }, [camera, game, simon]);

  const handleBackToIdle = useCallback(() => {
    handleDeactivateCamera();
    game.backToIdle();
    simon.backToIdle();
  }, [handleDeactivateCamera, game, simon]);

  const handleStartGame = useCallback(() => {
    if (isSimon) simon.startGame();
    else game.startGame();
  }, [isSimon, simon, game]);

  const handleQuit = useCallback(() => {
    if (isSimon) simon.quitGame();
    else game.quitGame();
  }, [isSimon, simon, game]);

  // ── Freeze-mode-only derived state ───────────────────────────────────────
  const isWon = !isSimon && game.gameState === GAME_STATE.WON;
  const sensitivityThreshold = game.customDynamicThreshold ?? SENSITIVITY_LEVELS[game.sensitivity].threshold;

  // The badge shows no text past the search, so screen readers get the state
  // from here instead.
  const stateDescription = isPlaying ? 'Partida en curso' : 'Jugador detectado';

  // Only the found-but-not-started badge is a bare dot now.
  const isReadyToStart = !isDetecting && !isPlaying;

  // Live movement read-out for the badge. The track tops out at twice the
  // threshold, so the halfway mark is the line that ends the round.
  const movementPercent = Math.min(100, (game.movementScore / (sensitivityThreshold * 2)) * 100);
  const movementLevel = game.movementScore > sensitivityThreshold
    ? 'var(--accent-red)'
    : game.movementScore > sensitivityThreshold * 0.6
      ? 'var(--accent-yellow)'
      : 'var(--accent-green)';

  const stageStyle = {
    top: stageInset.top,
    right: stageInset.right,
    bottom: stageInset.bottom,
    left: stageInset.left,
  };

  return (
    <div className="app" data-theme={theme}>
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={showCamera ? handleBackToIdle : undefined}
      />

      <main className="app-main">
        {/* ── IDLE: Welcome screen ── */}
        {!showCamera && (
          <section className="idle-screen animate-fadeIn" id="idle-screen">
            <div className="idle-hero">
              {isSimon ? (
                <>
                  <h1 className="idle-title">
                    ¿Podés seguirle el ritmo a <strong>Simón</strong>?
                  </h1>
                  <p className="idle-description">
                    Cumplí cada postura antes de que se acabe el tiempo y sumá puntos
                  </p>
                </>
              ) : (
                <>
                  <h1 className="idle-title">
                    ¿Podés <strong>engañar</strong> al sistema?
                  </h1>
                  <p className="idle-description">
                    <span className="idle-duration">{game.freezeSeconds}</span>
                    <span className="idle-duration-unit">segundos</span>
                    sin que C.U.I.D.A. detecte una sola señal de vida
                  </p>
                </>
              )}
            </div>

            {camera.error && (
              <div className="error-banner" role="alert" id="camera-error">
                {camera.error}
              </div>
            )}

            {pose.loadError && (
              <div className="error-banner" role="alert" id="model-error">
                {pose.loadError}
              </div>
            )}

            <div className="idle-actions">
              {pose.isLoading ? (
                <div className="loading-indicator">
                  <div className="spinner" />
                  <span>Preparando el desafío…</span>
                </div>
              ) : (
                <button
                  id="start-challenge-btn"
                  className="btn btn-primary btn-lg idle-cta"
                  onClick={handleActivateCamera}
                  disabled={camera.isStarting}
                >
                  {camera.isStarting ? (
                    <>
                      <div className="spinner spinner-sm" />
                      Iniciando…
                    </>
                  ) : (
                    <>Iniciar desafío</>
                  )}
                </button>
              )}
            </div>
          </section>
        )}

        {/* ── Camera fullscreen + HUD overlay ── */}
        {showCamera && (
          <div className="game-layout" id="game-layout">
            {/* Camera takes full space */}
            <div className="game-camera-wrap">
              <CameraView
                videoRef={camera.videoRef}
                stream={camera.stream}
                videoSrc={camera.videoSrc}
                videoLoop={videoConfig.videoLoop}
                mirrorVideo={videoConfig.mirrorVideo}
                onVideoReady={camera.handleVideoReady}
                onVideoError={camera.handleVideoError}
                landmarks={pose.landmarks}
                gameState={activeGameState}
                observation={(!isRoundActive && showAmbientTag) ? ambient.observation : null}
                onStageRectChange={setStageInset}
              />

              {/* Panels confined to the visible video rect */}
              <div className="game-stage" style={stageStyle}>
                {camera.error && (
                  <div className="error-banner vm-error" role="alert" id="camera-live-error">
                    {camera.error}
                  </div>
                )}

                {!isPlaying && !isResult && (
                  <IdleAttractScreen gameMode={gameMode} />
                )}

                {!isSimon && diagOpen && (
                  <DiagnosticPanel
                    diagnostics={game.diagnostics}
                    sensitivity={SENSITIVITY_LEVELS[game.sensitivity].label}
                  />
                )}

                  { isPlaying && (isSimon ? (
                    <SimonCommandPanel
                      currentCommand={simon.currentCommand}
                      commandIndex={simon.commandIndex}
                      totalCommands={simon.totalCommands}
                      score={simon.score}
                      lastCommandResult={simon.lastCommandResult}
                      isHolding={simon.isHolding}
                    />
                ) : (
                <VitalityMonitor
                  reading={game.vitality}
                  faceLoading={face.isLoading || (!face.isModelReady && !face.loadError)}
                  gestureDrift={game.gestureDrift}
                  gestureThreshold={game.customGestureThreshold ?? SENSITIVITY_LEVELS[game.sensitivity].gestureThreshold}
                  detectGestures={game.detectGestures}
                  detectBlink={game.detectBlink}
                  blinkCount={game.blinkCount}
                  blinkLimit={game.blinkLimit}
                  movementScore={game.movementScore}
                  movementThreshold={sensitivityThreshold}
                />
                ))}
                {!isSimon && face.loadError && (
                  <div className="error-banner vm-error" role="alert">
                    {face.loadError}
                  </div>
                )}
              </div>

              {/* ─ HUD overlay — confined to the visible video rect ─ */}
              {!isResult && (
                <div className="game-hud" aria-live="polite" style={stageStyle}>

                  {/* Top row: state badge, plus a way out mid-round. */}
                  <div className="hud-top">
                    <div
                      className={`state-badge state-${activeGameState.toLowerCase()}${isReadyToStart ? ' state-badge-dot-only' : ''}`}
                      id="game-state-badge"
                      title={isDetecting ? undefined : stateDescription}
                    >
                      <span className="state-dot" />

                      {isDetecting && <span className="state-label">Buscando al jugador…</span>}

                      {isPlaying && !isSimon && (
                        <span
                          className="state-movement"
                          role="meter"
                          aria-live="off"
                          aria-label="Movimiento detectado"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(movementPercent)}
                        >
                          <span
                            className="state-movement-fill"
                            style={{
                              width: `${movementPercent}%`,
                              background: movementLevel,
                            }}
                          />
                        </span>
                      )}

                      {!isDetecting && <span className="sr-only">{stateDescription}</span>}
                    </div>

                    {isPlaying && <QuitButton onConfirm={handleQuit} />}
                  </div>

                  {/* Bottom: timer / buttons */}
                  <div className="hud-bottom">
                    {/* Timer (PLAYING) */}
                    {isPlaying && (
                      <div className="hud-timer animate-fadeInScale">
                        {isSimon
                          ? <Timer timeLeft={simon.timeLeftInCommand} totalSeconds={simon.commandSeconds} />
                          : <Timer timeLeft={game.timeLeft} totalSeconds={game.freezeSeconds} />}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="hud-actions">
                      {isReady && (
                        <button
                          id="start-game-btn"
                          className="btn btn-success btn-lg animate-fadeIn"
                          onClick={handleStartGame}
                        >
                          Empezar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Result overlay on top of camera */}
              {isResult && (isSimon ? (
                <SimonResultScreen
                  score={simon.score}
                  completedCount={simon.completedCount}
                  totalCommands={simon.totalCommands}
                  rewardUnlocked={simon.rewardUnlocked}
                  abandoned={simon.abandoned}
                  onFinish={handleBackToIdle}
                />
              ) : (
                <ResultScreen
                  won={isWon}
                  onFinish={handleBackToIdle}
                  freezeSeconds={game.freezeSeconds}
                  infractionReason={game.infractionReason}
                  replayData={game.replayData}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
