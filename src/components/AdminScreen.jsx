import React, { useEffect, useState } from 'react';
import {
  SENSITIVITY_LEVELS,
  MIN_FREEZE_SECONDS,
  MAX_FREEZE_SECONDS,
} from '../lib/constants.js';
import { GAME_STATE } from '../hooks/useGameLogic.js';
import {
  readSettings,
  writeSettings,
  readTelemetry,
  subscribeTelemetry,
  TELEMETRY_STALE_MS,
} from '../lib/adminSync.js';
import '../App.css';
import './AdminScreen.css';

const BLINK_OPTIONS = [
  { value: 0, label: 'Ninguno' },
  { value: 1, label: '1' },
  { value: 3, label: '3' },
  { value: 5, label: '5' },
];

// How far past the current threshold the live meter's scale extends —
// keeps the bar readable instead of pinning at 100% the instant it breaches.
const METER_HEADROOM = 1.8;

const STATE_LABELS = {
  [GAME_STATE.IDLE]: 'En portada',
  [GAME_STATE.DETECTING]: 'Buscando jugador',
  [GAME_STATE.READY]: 'Listo para jugar',
  [GAME_STATE.PLAYING]: 'Jugando',
  [GAME_STATE.WON]: 'Ganó',
  [GAME_STATE.LOST]: 'Detectado',
};

/**
 * AdminScreen
 * Standalone config page (index.html#admin), opened in its own tab/window so
 * participants never see settings being adjusted. Talks to the game tab only
 * through adminSync (localStorage + `storage` events); changes apply live.
 */
export default function AdminScreen() {
  const [settings, setSettings] = useState(readSettings);
  const [telemetry, setTelemetry] = useState(readTelemetry);
  const [now, setNow] = useState(() => Date.now());
  // Mirrors the game tab's theme toggle (same localStorage key).
  const [theme, setTheme] = useState(() => localStorage.getItem('cuida-theme') || 'dark');

  // Written immediately — the game tab picks changes up live via `storage`.
  const update = (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeSettings(next);
  };

  useEffect(() => subscribeTelemetry(setTelemetry), []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'cuida-theme' && e.newValue) setTheme(e.newValue);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Telemetry only updates on a `storage` event; tick locally so a game tab
  // that was closed is reflected as "sin conexión" too.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const { freezeSeconds, sensitivity, detectGestures, detectBlink, blinkBudget } = settings;

  const isConnected = !!telemetry && now - telemetry.ts < TELEMETRY_STALE_MS;
  const movementScore = isConnected ? telemetry.movementScore ?? 0 : 0;
  const hasLiveReading = isConnected && telemetry.hasLiveReading;
  const gameState = isConnected ? telemetry.gameState : null;

  const { threshold } = SENSITIVITY_LEVELS[sensitivity];
  const meterPercent = Math.min(100, (movementScore / (threshold * METER_HEADROOM)) * 100);
  const isOverThreshold = movementScore > threshold;

  return (
    <div className="app admin-page" data-theme={theme}>
      <div className="admin-screen glass animate-fadeInScale" id="admin-screen">
        {/* Header */}
        <div className="admin-header">
          <div>
            <h1 className="admin-title">Configuración</h1>
            <p className="admin-subtitle">Pantalla aparte — los participantes no la ven</p>
          </div>
          <div className={`admin-conn-badge ${isConnected ? 'connected' : ''}`}>
            <span className="state-dot" />
            {isConnected ? (STATE_LABELS[gameState] || 'Conectado') : 'Sin pantalla de juego'}
          </div>
        </div>

        <div className="admin-divider" />

        {/* Freeze duration */}
        <section className="admin-section">
          <label className="admin-label" htmlFor="freeze-slider">
            Tiempo para ganar
            <span className="admin-value-badge">{freezeSeconds}s</span>
          </label>
          <div className="admin-slider-wrap">
            <span className="admin-range-hint">{MIN_FREEZE_SECONDS}s</span>
            <input
              id="freeze-slider"
              type="range"
              min={MIN_FREEZE_SECONDS}
              max={MAX_FREEZE_SECONDS}
              step={1}
              value={freezeSeconds}
              onChange={(e) => update({ freezeSeconds: Number(e.target.value) })}
              className="admin-slider"
            />
            <span className="admin-range-hint">{MAX_FREEZE_SECONDS}s</span>
          </div>
          <p className="admin-hint">
            El jugador debe permanecer quieto durante <strong>{freezeSeconds} segundo{freezeSeconds !== 1 ? 's' : ''}</strong> sin moverse.
          </p>
        </section>

        <div className="admin-divider" />

        {/* Sensitivity */}
        <section className="admin-section">
          <label className="admin-label">Sensibilidad de detección</label>
          <div className="admin-sensitivity-grid">
            {Object.entries(SENSITIVITY_LEVELS).map(([key, level]) => (
              <button
                key={key}
                id={`sensitivity-${key}`}
                className={`admin-sensitivity-btn ${sensitivity === key ? 'active' : ''}`}
                onClick={() => update({ sensitivity: key })}
              >
                <span className="sensitivity-name">{level.label}</span>
                <span className="sensitivity-desc">{level.description}</span>
              </button>
            ))}
          </div>

          {/* Live meter — the real movement reading relayed from the game tab */}
          <div className="admin-meter">
            <div className="admin-meter-track">
              <div
                className={`admin-meter-fill ${isOverThreshold ? 'over' : ''}`}
                style={{ width: `${meterPercent}%` }}
              />
              <div className="admin-meter-threshold-line" style={{ left: `${100 / METER_HEADROOM}%` }} />
            </div>
            <p className="admin-hint">
              {hasLiveReading
                ? <>Movimiento en vivo: <strong>{movementScore.toFixed(4)}</strong> · umbral: <strong>{threshold.toFixed(4)}</strong></>
                : isConnected
                  ? 'La lectura en vivo aparece mientras se juega una ronda.'
                  : 'Abrí la pantalla de juego en otra pestaña para ver la lectura en vivo.'}
            </p>
          </div>
        </section>

        <div className="admin-divider" />

        <section className="admin-section">
          <label className="admin-label">Señales faciales</label>

          <label className="admin-toggle">
            <input
              type="checkbox"
              id="detect-gestures"
              checked={detectGestures}
              onChange={(e) => update({ detectGestures: e.target.checked })}
            />
            <span className="admin-toggle-body">
              <span className="admin-toggle-name">Penalizar gestos faciales</span>
              <span className="admin-toggle-desc">
                Sonreír, abrir la boca o levantar las cejas termina la ronda.
              </span>
            </span>
          </label>

          <label className="admin-toggle">
            <input
              type="checkbox"
              id="detect-blink"
              checked={detectBlink}
              onChange={(e) => update({ detectBlink: e.target.checked })}
            />
            <span className="admin-toggle-body">
              <span className="admin-toggle-name">Detectar parpadeo</span>
              <span className="admin-toggle-desc">
                Con tolerancia 0, el primer parpadeo delata al jugador.
              </span>
            </span>
          </label>
        </section>

        <div className="admin-divider" />

        <section className="admin-section">
          <label className="admin-label">
            Parpadeos tolerados
            <span className="admin-value">
              {blinkBudget === 0 ? 'Ninguno' : blinkBudget}
            </span>
          </label>
          <p className="admin-hint">
            Cuántos parpadeos se le toleran al jugador antes de que el sistema
            lo dé por detectado. Un adulto en reposo parpadea unas 15 veces por
            minuto, así que cualquier tolerancia baja es un desafío real.
          </p>
          <div className="admin-sensitivity-grid admin-blink-grid">
            {BLINK_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                id={`blink-${opt.value}`}
                className={`admin-sensitivity-btn ${blinkBudget === opt.value ? 'active' : ''}`}
                onClick={() => update({ blinkBudget: opt.value })}
              >
                <span className="sensitivity-name">{opt.label}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="admin-divider" />

        {/* Footer — tech info lives here */}
        <div className="admin-footer">
          <div className="admin-tech-badge">
            <span className="tech-dot" style={{ background: 'var(--signal)' }} />
            MediaPipe Pose + Face Landmarker
          </div>
          <div className="admin-tech-badge">
            <span className="tech-dot" style={{ background: 'var(--pulse)' }} />
            C.U.I.D.A. Vision Engine
          </div>
        </div>
      </div>
    </div>
  );
}
