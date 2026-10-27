import React, { useState, useEffect, useCallback } from 'react';
import { useCamera } from './hooks/useCamera.js';
import { usePoseDetection } from './hooks/usePoseDetection.js';
import { useGameLogic, GAME_STATE } from './hooks/useGameLogic.js';
import { SENSITIVITY_LEVELS } from './lib/constants.js';
import Header from './components/Header.jsx';
import CameraView from './components/CameraView.jsx';
import Timer from './components/Timer.jsx';
import ResultScreen from './components/ResultScreen.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import DiagnosticPanel from './components/DiagnosticPanel.jsx';
import VitalityMonitor from './components/VitalityMonitor.jsx';
import { useFaceDetection } from './hooks/useFaceDetection.js';
import './App.css';

export default function App() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const [theme, setTheme] = useState(() =>
    localStorage.getItem('cuida-theme') || 'dark'
  );

  const camera = useCamera();
  const game = useGameLogic();
  const pose = usePoseDetection(camera.videoRef, null, camera.isReady);

  // Keep the facial detector fully stopped until the player starts the round.
  // Pose detection still checks presence so the UI can enable "Empezar".
  const faceEnabled = camera.isReady && game.gameState === GAME_STATE.PLAYING;
  const face = useFaceDetection(camera.videoRef, camera.isReady, faceEnabled);

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
    onFrameRef.current = (lms) => onGameFrame(lms);
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

  // ── Derived state ────────────────────────────────────────────────────────
  const isPlaying = game.gameState === GAME_STATE.PLAYING;
  const isWon     = game.gameState === GAME_STATE.WON;
  const isLost    = game.gameState === GAME_STATE.LOST;
  const isResult  = isWon || isLost;
  const showCamera = [GAME_STATE.DETECTING, GAME_STATE.READY, GAME_STATE.PLAYING, GAME_STATE.WON, GAME_STATE.LOST]
    .includes(game.gameState);

  const sensitivityThreshold = SENSITIVITY_LEVELS[game.sensitivity].threshold;

  return (
    <div className="app" data-theme={theme}>
      <Header
        onAdminClick={() => setAdminOpen(true)}
        theme={theme}
        onToggleTheme={toggleTheme}
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
              />

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

              {/* ─ HUD overlay ─ */}
              {!isResult && (
                <div className="game-hud" aria-live="polite">

                  {/* Top row: state badge (left) + config (right) */}
                  <div className="hud-top">
                    <div className={`state-badge state-${game.gameState.toLowerCase()}`} id="game-state-badge">
                      <span className="state-dot" />
                      <span className="state-label">
                        {game.gameState === GAME_STATE.DETECTING && 'Buscando jugador…'}
                        {game.gameState === GAME_STATE.READY     && 'Listo — te estamos viendo'}
                        {game.gameState === GAME_STATE.PLAYING   && 'Intentá no ser detectado'}
                        {game.gameState === GAME_STATE.WON       && '¡Nos engañaste!'}
                        {game.gameState === GAME_STATE.LOST      && 'Te detectamos'}
                      </span>
                    </div>

                    <div className="hud-config glass">
                      <span className="hud-config-row">
                        <span className="hud-config-label">Tiempo</span>
                        <span className="hud-config-value">{game.freezeSeconds}s</span>
                      </span>
                      <span className="hud-config-sep" />
                      <span className="hud-config-row">
                        <span className="hud-config-label">Sensibilidad</span>
                        <span className="hud-config-value">{SENSITIVITY_LEVELS[game.sensitivity].label}</span>
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
                      <button
                        id="stop-camera-btn"
                        className="btn btn-ghost hud-btn-back"
                        onClick={handleDeactivateCamera}
                      >
                        Volver al inicio
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Result overlay on top of camera */}
              {isResult && (
                <ResultScreen
                  won={isWon}
                  onRetry={game.reset}
                  onBack={() => {
                    handleDeactivateCamera();
                    game.backToIdle();
                  }}
                  freezeSeconds={game.freezeSeconds}
                  infractionReason={game.infractionReason}
                  blinkCount={game.blinkCount}
                  vitality={game.vitality}
                  detectedSignal={game.detectedSignal}
                />
              )}
            </div>
          </div>
        )}
      </main>

      {/* Admin panel modal */}
      <AdminPanel
        isOpen={adminOpen}
        onClose={() => setAdminOpen(false)}
        freezeSeconds={game.freezeSeconds}
        onFreezeSecondsChange={game.setFreezeSeconds}
        sensitivity={game.sensitivity}
        onSensitivityChange={game.setSensitivity}
        detectGestures={game.detectGestures}
        onDetectGesturesChange={game.setDetectGestures}
        blinkBudget={game.blinkBudget}
        onBlinkBudgetChange={game.setBlinkBudget}
        detectBlink={game.detectBlink}
        onDetectBlinkChange={game.setDetectBlink}
        detectBreathing={game.detectBreathing}
        onDetectBreathingChange={game.setDetectBreathing}
      />
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
