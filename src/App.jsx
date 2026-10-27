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
      game.setDetectBreathing(settings.detectBreathing);
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
  const isPlaying = game.gameState === GAME_STATE.PLAYING;
  const isWon     = game.gameState === GAME_STATE.WON;
  const isLost    = game.gameState === GAME_STATE.LOST;
  const isResult  = isWon || isLost;
  const showCamera = [GAME_STATE.DETECTING, GAME_STATE.READY, GAME_STATE.PLAYING, GAME_STATE.WON, GAME_STATE.LOST]
    .includes(game.gameState);

  const sensitivityThreshold = SENSITIVITY_LEVELS[game.sensitivity].threshold;

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
                Durante <strong>{game.freezeSeconds} segundos</strong>, evitá que
                {' '}<strong>C.U.I.D.A.</strong> detecte movimiento o gestos.
                Se permiten algunos parpadeos; la respiración se muestra como
                señal informativa.
              </p>
              <p className="idle-prize">
                Nadie lo logró todavía. Si lo conseguís, te llevás el premio.
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
                  <span>Cargando modelo de detección…</span>
                </div>
              ) : (
                <button
                  id="activate-camera-btn"
                  className="btn btn-primary btn-lg"
                  onClick={handleActivateCamera}
                  disabled={camera.isStarting}
                >
                  {camera.isStarting ? (
                    <>
                      <div className="spinner spinner-sm" />
                      Iniciando…
                    </>
                  ) : (
                    <>Activar cámara</>
                  )}
                </button>
              )}
            </div>

            <p className="idle-cuida-tagline">
              C.U.I.D.A. — Sistema de monitoreo inteligente de adultos mayores
            </p>
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

                {!isResult && (
                  <VitalityMonitor
                    reading={game.vitality}
                    faceLoading={face.isLoading || (!face.isModelReady && !face.loadError)}
                    gestureDrift={game.gestureDrift}
                    gestureThreshold={SENSITIVITY_LEVELS[game.sensitivity].gestureThreshold}
                    detectGestures={game.detectGestures}
                    detectBlink={game.detectBlink}
                    detectBreathing={game.detectBreathing}
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

                  {/* Top row: state badge */}
                  <div className="hud-top">
                    <div className={`state-badge state-${game.gameState.toLowerCase()}`} id="game-state-badge">
                      <span className="state-dot" />
                      <span className="state-label">
                        {game.gameState === GAME_STATE.DETECTING && 'Buscando jugador…'}
                        {game.gameState === GAME_STATE.READY     && 'Listo — te estamos viendo'}
                        {game.gameState === GAME_STATE.PLAYING   && 'Intentá no ser detectado'}
                      </span>
                    </div>
                  </div>

                  {/* Bottom: timer / instructions / buttons */}
                  <div className="hud-bottom">
                    {/* Timer (PLAYING) */}
                    {isPlaying && (
                      <div className="hud-timer animate-fadeInScale">
                        <Timer timeLeft={game.timeLeft} totalSeconds={game.freezeSeconds} />
                        <p className="timer-hint">segundos sin ser detectado</p>
                      </div>
                    )}

                    {/* Instructions (DETECTING / READY) */}
                    {!isPlaying && (
                      <div className="hud-instructions animate-fadeIn glass">
                        {game.gameState === GAME_STATE.DETECTING && (
                          <>
                            <ScanIcon />
                            <p>Colocate frente a la cámara</p>
                            <p className="instruction-sub">El sistema necesita verte antes de empezar</p>
                          </>
                        )}
                        {game.gameState === GAME_STATE.READY && (
                          <>
                            <ReadyIcon />
                            <p>Te encontramos</p>
                            <p className="instruction-sub">A partir de ahora, intentá desaparecer</p>
                          </>
                        )}
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

/* ── Inline SVG icons for HUD instructions ── */
function ScanIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="hud-instr-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M3 9V5a2 2 0 0 1 2-2h4" />
      <path d="M21 9V5a2 2 0 0 0-2-2h-4" />
      <path d="M3 15v4a2 2 0 0 0 2 2h4" />
      <path d="M21 15v4a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

function ReadyIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="hud-instr-icon" style={{ color: 'var(--pulse)' }} aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}
