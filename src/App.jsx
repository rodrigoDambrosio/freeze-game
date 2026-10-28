import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCamera } from './hooks/useCamera.js';
import { usePoseDetection } from './hooks/usePoseDetection.js';
import { useGameLogic, GAME_STATE } from './hooks/useGameLogic.js';
import { SENSITIVITY_LEVELS, REPLAY_FRAME_WIDTH } from './lib/constants.js';
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
  const canvas = document.createElement('canvas');
  canvas.width = REPLAY_FRAME_WIDTH;
  canvas.height = Math.round(REPLAY_FRAME_WIDTH * (video.videoHeight / video.videoWidth));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export default function App() {
  const [diagOpen, setDiagOpen] = useState(false);

  const [theme, setTheme] = useState(() =>
    localStorage.getItem('cuida-theme') || 'dark'
  );
  // Visible-video rect reported by CameraView — confines the HUD (badge,
  // timer, buttons) to the actual camera image, never the letterbox bars.
  const [stageInset, setStageInset] = useState({ top: 0, right: 0, bottom: 0, left: 0 });

  const camera = useCamera();
  const game = useGameLogic();
  const pose = usePoseDetection(camera.videoRef, null, camera.isReady);
  const lastTelemetryAtRef = useRef(0);

  // Keep the facial detector fully stopped until the player starts the round.
  // Pose detection still checks presence so the UI can enable "Empezar".
  const faceEnabled = camera.isReady && game.gameState === GAME_STATE.PLAYING;
  const face = useFaceDetection(camera.videoRef, camera.isReady, faceEnabled);

  // ── Admin settings arrive from the separate admin tab/window (#admin),
  // never from UI on this participant-facing screen ─────────────────────────
  useEffect(() => {
    const apply = (settings) => {
      game.setFreezeSeconds(settings.freezeSeconds);
      game.setSensitivity(settings.sensitivity);
      game.setDetectGestures(settings.detectGestures);
      game.setDetectBlink(settings.detectBlink);
      game.setBlinkBudget(settings.blinkBudget);
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
    telemetryRef.current = {
      movementScore: game.movementScore,
      hasLiveReading: game.gameState === GAME_STATE.PLAYING,
      gameState: game.gameState,
    };
    const now = performance.now();
    if (prevState === game.gameState && now - lastTelemetryAtRef.current < TELEMETRY_MIN_INTERVAL_MS) return;
    lastTelemetryAtRef.current = now;
    writeTelemetry(telemetryRef.current);
  }, [game.movementScore, game.gameState]);

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
  // Fed straight from the inference loop rather than from the landmarks state:
  // React skips a re-render when the pose is null two frames running, which
  // would stop the game from ever seeing a sustained loss of detection.
  const { onFrameRef } = pose;
  const onGameFrame = game.onFrame;
  useEffect(() => {
    onFrameRef.current = (lms, video) => onGameFrame(lms, () => grabVideoFrame(video));
    return () => {
      onFrameRef.current = null;
    };
  }, [onFrameRef, onGameFrame]);

  // Face stream carries blinking, expression and the gesture judgement.
  const faceFrameRef = face.onFrameRef;
  const onGameFace = game.onFaceFrame;
  useEffect(() => {
    faceFrameRef.current = onGameFace;
    return () => {
      faceFrameRef.current = null;
    };
  }, [faceFrameRef, onGameFace]);

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
    await camera.startCamera();
  }, [camera, game]);

  const handleDeactivateCamera = useCallback(() => {
    camera.stopCamera();
    game.onCameraDeactivated();
  }, [camera, game]);

  const handleBackToIdle = useCallback(() => {
    handleDeactivateCamera();
    game.backToIdle();
  }, [handleDeactivateCamera, game]);

  // ── Derived state ────────────────────────────────────────────────────────
  const isPlaying   = game.gameState === GAME_STATE.PLAYING;
  const isDetecting = game.gameState === GAME_STATE.DETECTING;
  const isWon     = game.gameState === GAME_STATE.WON;
  const isLost    = game.gameState === GAME_STATE.LOST;
  const isResult  = isWon || isLost;
  const showCamera = [GAME_STATE.DETECTING, GAME_STATE.READY, GAME_STATE.PLAYING, GAME_STATE.WON, GAME_STATE.LOST]
    .includes(game.gameState);

  const sensitivityThreshold = SENSITIVITY_LEVELS[game.sensitivity].threshold;

  // The badge shows no text past the search, so screen readers get the state
  // from here instead.
  const stateDescription = isPlaying ? 'Partida en curso' : 'Jugador detectado';

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
        {game.gameState === GAME_STATE.IDLE && (
          <section className="idle-screen animate-fadeIn" id="idle-screen">
            <div className="idle-hero">
              <h1 className="idle-title">
                ¿Podés <strong>engañar</strong> al sistema?
              </h1>
              <p className="idle-description">
                <span className="idle-duration">{game.freezeSeconds}</span>
                <span className="idle-duration-unit">segundos</span>
                sin que C.U.I.D.A. detecte una sola señal de vida
              </p>
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
                onVideoReady={camera.handleVideoReady}
                landmarks={pose.landmarks}
                gameState={game.gameState}
                movementScore={game.movementScore}
                sensitivityThreshold={sensitivityThreshold}
                onStageRectChange={setStageInset}
              />

              {/* Panels confined to the visible video rect */}
              <div className="game-stage" style={stageStyle}>
                {diagOpen && (
                  <DiagnosticPanel
                    diagnostics={game.diagnostics}
                    sensitivity={SENSITIVITY_LEVELS[game.sensitivity].label}
                  />
                )}

                {isPlaying && (
                  <VitalityMonitor
                    reading={game.vitality}
                    faceLoading={face.isLoading || (!face.isModelReady && !face.loadError)}
                    gestureDrift={game.gestureDrift}
                    gestureThreshold={SENSITIVITY_LEVELS[game.sensitivity].gestureThreshold}
                    detectGestures={game.detectGestures}
                    detectBlink={game.detectBlink}
                    blinkCount={game.blinkCount}
                    blinkLimit={game.blinkLimit}
                  />
                )}
                {face.loadError && (
                  <div className="error-banner vm-error" role="alert">
                    {face.loadError}
                  </div>
                )}
              </div>

              {/* ─ HUD overlay — confined to the visible video rect ─ */}
              {!isResult && (
                <div className="game-hud" aria-live="polite" style={stageStyle}>

                  {/* Top row: state badge. Only the search needs words — once
                      the player is found the badge is a bare dot, since the
                      framing and the timer already carry the state. */}
                  <div className="hud-top">
                    <div
                      className={`state-badge state-${game.gameState.toLowerCase()}${isDetecting ? '' : ' state-badge-dot-only'}`}
                      id="game-state-badge"
                      title={isDetecting ? undefined : stateDescription}
                    >
                      <span className="state-dot" />
                      {isDetecting
                        ? <span className="state-label">Buscando al jugador…</span>
                        : <span className="sr-only">{stateDescription}</span>}
                    </div>
                  </div>

                  {/* Bottom: timer / buttons */}
                  <div className="hud-bottom">
                    {/* Timer (PLAYING) */}
                    {isPlaying && (
                      <div className="hud-timer animate-fadeInScale">
                        <Timer timeLeft={game.timeLeft} totalSeconds={game.freezeSeconds} />
                        <p className="timer-hint">segundos sin ser detectado</p>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="hud-actions">
                      {game.gameState === GAME_STATE.READY && (
                        <button
                          id="start-game-btn"
                          className="btn btn-success btn-lg animate-fadeIn"
                          onClick={game.startGame}
                        >
                          Empezar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Result overlay on top of camera */}
              {isResult && (
                <ResultScreen
                  won={isWon}
                  onRetry={game.reset}
                  freezeSeconds={game.freezeSeconds}
                  infractionReason={game.infractionReason}
                  blinkCount={game.blinkCount}
                  vitality={game.vitality}
                  detectedSignal={game.detectedSignal}
                  replayData={game.replayData}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

