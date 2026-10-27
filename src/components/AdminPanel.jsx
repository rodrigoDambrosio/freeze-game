import React from 'react';
import {
  SENSITIVITY_LEVELS,
  MIN_FREEZE_SECONDS,
  MAX_FREEZE_SECONDS,
} from '../lib/constants.js';
import './AdminPanel.css';

/**
 * AdminPanel
 * Modal glassmorphism panel for admin configuration.
 * Controls: freeze duration (slider) + sensitivity (radio buttons).
 */
const BLINK_OPTIONS = [
  { value: 0, label: 'Ninguno' },
  { value: 1, label: '1' },
  { value: 3, label: '3' },
  { value: 5, label: '5' },
];

export default function AdminPanel({
  isOpen,
  onClose,
  freezeSeconds,
  onFreezeSecondsChange,
  sensitivity,
  onSensitivityChange,
  detectGestures,
  onDetectGesturesChange,
  blinkBudget,
  onBlinkBudgetChange,
  detectBlink,
  onDetectBlinkChange,
  detectBreathing,
  onDetectBreathingChange,
}) {
  if (!isOpen) return null;

  return (
    <div className="admin-backdrop" onClick={onClose} id="admin-backdrop">
      <div
        className="admin-panel glass animate-fadeInScale"
        onClick={(e) => e.stopPropagation()}
        id="admin-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Configuración del administrador"
      >
        {/* Header */}
        <div className="admin-header">
          <div>
            <h2 className="admin-title">Configuración</h2>
            <p className="admin-subtitle">Solo para el administrador del juego</p>
          </div>
          <button
            id="admin-close-btn"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Cerrar configuración"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
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
              onChange={(e) => onFreezeSecondsChange(Number(e.target.value))}
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
                onClick={() => onSensitivityChange(key)}
              >
                <span className="sensitivity-name">{level.label}</span>
                <span className="sensitivity-desc">{level.description}</span>
              </button>
            ))}
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
              onChange={(e) => onDetectGesturesChange(e.target.checked)}
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
              id="detect-breathing"
              checked={detectBreathing}
              onChange={(e) => onDetectBreathingChange(e.target.checked)}
            />
            <span className="admin-toggle-body">
              <span className="admin-toggle-name">Detectar respiración</span>
              <span className="admin-toggle-desc">
                La señal más difícil de suprimir, y la que casi nadie logra
                ocultar. Desactivala para que el desafío sea ganable.
              </span>
            </span>
          </label>

          <label className="admin-toggle">
            <input
              type="checkbox"
              id="detect-blink"
              checked={detectBlink}
              onChange={(e) => onDetectBlinkChange(e.target.checked)}
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
          <label className="admin-label" htmlFor="blink-budget">
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
                onClick={() => onBlinkBudgetChange(opt.value)}
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
