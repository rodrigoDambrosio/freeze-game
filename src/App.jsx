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
import './App.css';

export default function App() {
  const [adminOpen, setAdminOpen] = useState(false);
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('cuida-theme') || 'dark'
  );

  const camera = useCamera();
  const game = useGameLogic();
  const pose = usePoseDetection(camera.videoRef, null, camera.isReady);

  // ── Persist theme ─────────────────────────────────────────────────────────
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('cuida-theme', next);
      return next;
    });
  }, []);

  // ── Wire pose detections → game logic ────────────────────────────────────
  useEffect(() => {
    if (!pose.isRunning) return;
    const hasPose = !!pose.landmarks;
    game.onPoseDetected(hasPose);
    game.onFrame(pose.landmarks);
  }, [pose.landmarks, pose.isRunning]); // eslint-disable-line

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
                <strong>Freeze</strong> Challenge
              </h1>
              <p className="idle-description">
                Quedate quieto por <strong>{game.freezeSeconds} segundos</strong> para ganar.
                El sistema de visión de <strong>C.U.I.D.A.</strong> detecta cada movimiento.
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

              {/* ─ HUD overlay ─ */}
              {!isResult && (
                <div className="game-hud" aria-live="polite">

                  {/* Top row: state badge (left) + config (right) */}
                  <div className="hud-top">
                    <div className={`state-badge state-${game.gameState.toLowerCase()}`} id="game-state-badge">
                      <span className="state-dot" />
                      <span className="state-label">
                        {game.gameState === GAME_STATE.DETECTING && 'Buscando jugador…'}
                        {game.gameState === GAME_STATE.READY     && '¡Listo para jugar!'}
                        {game.gameState === GAME_STATE.PLAYING   && '¡No te muevas!'}
                        {game.gameState === GAME_STATE.WON       && '¡Victoria!'}
                        {game.gameState === GAME_STATE.LOST      && '¡Movimiento!'}
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
                        <p className="timer-hint">segundos para ganar</p>
                      </div>
                    )}

                    {/* Instructions (DETECTING / READY) */}
                    {!isPlaying && (
                      <div className="hud-instructions animate-fadeIn glass">
                        {game.gameState === GAME_STATE.DETECTING && (
                          <>
                            <ScanIcon />
                            <p>Colocate frente a la cámara</p>
                            <p className="instruction-sub">El sistema te detectará automáticamente</p>
                          </>
                        )}
                        {game.gameState === GAME_STATE.READY && (
                          <>
                            <ReadyIcon />
                            <p>¡Persona detectada!</p>
                            <p className="instruction-sub">El administrador puede iniciar el juego</p>
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
