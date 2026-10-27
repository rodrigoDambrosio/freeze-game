import React from 'react';
import './ResultScreen.css';

const PARTICLE_COLORS = ['#5b9cf5', '#3dd68c', '#e8aa42', '#a78bfa', '#f472b6'];

const STATIC_PARTICLES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  x: 10 + ((i * 19) % 80),
  delay: ((i * 7) % 10) * 0.1,
  duration: 1.0 + ((i * 3) % 6) * 0.12,
  size: 5 + ((i * 5) % 8),
  color: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
}));

/**
 * ResultScreen
 * Full-screen overlay shown when the game ends (WON or LOST).
 * Victory → green pulse + confetti particles
 * Defeat  → red shake
 */
const SIGNAL_NAMES = {
  movement: 'el detector de movimiento',
  gesture: 'el detector de gestos faciales',
  blink: 'el detector de parpadeo',
  breathing: 'el detector de respiración',
  absent: 'la pérdida de encuadre',
};

export default function ResultScreen({
  won, onRetry, onBack, freezeSeconds, infractionReason, blinkCount, vitality,
  detectedSignal,
}) {
  const particles = won ? STATIC_PARTICLES : [];

  return (
    <div className={`result-screen ${won ? 'result-won' : 'result-lost'}`} id="result-screen">

      {/* Particles (confetti) */}
      {won && particles.map((p) => (
        <div
          key={p.id}
          className="particle"
          style={{
            left: `${p.x}%`,
            bottom: '28%',
            width: p.size,
            height: p.size,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}

      {/* Main card */}
      <div className={`result-card glass animate-fadeInScale ${won ? '' : 'animate-shake'}`}>

        {/* Result mark */}
        <div className={`result-mark ${won ? 'result-mark-won' : 'result-mark-lost'}`}>
          {won ? (
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Victoria">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Derrota">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          )}
        </div>

        {/* Headline */}
        <h1 className="result-title">
          {won ? '¡Nos engañaste!' : 'Te detectamos'}
        </h1>

        <p className="result-subtitle">
          {won
            ? `${freezeSeconds} segundos sin una sola señal de vida. Reclamá tu premio.`
            : infractionReason
            ? `${infractionReason}.`
            : 'El sistema encontró una señal de vida.'}
        </p>

        {/* What the system picked up while the round ran. Blinking is listed
            even though it never costs the round: seeing it counted is the
            point — the same sensing that judges the game is what tells a
            monitor whether someone is still responsive. */}
        {!won && detectedSignal && (
          <p className="result-caught">
            Te delató: <strong>{SIGNAL_NAMES[detectedSignal] ?? detectedSignal}</strong>
          </p>
        )}

        <div className="result-signals">
          <div className="result-signal">
            <span className="result-signal-value">{blinkCount ?? 0}</span>
            <span className="result-signal-label">parpadeos</span>
          </div>
          {vitality?.breathingDetected && (
            <div className="result-signal">
              <span className="result-signal-value">
                {vitality.rateKnown && vitality.breathingRate !== null
                  ? vitality.breathingRate.toFixed(0)
                  : 'detectada'}
              </span>
              <span className="result-signal-label">
                {vitality.rateKnown ? 'respiraciones / min' : 'respiración'}
              </span>
            </div>
          )}
          {vitality?.label && (
            <div className="result-signal">
              <span className="result-signal-value result-signal-text">
                {vitality.label}
              </span>
              <span className="result-signal-label">estado vital</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="result-actions">
          <button
            id="result-retry-btn"
            className={`btn btn-lg ${won ? 'btn-success' : 'btn-danger'}`}
            onClick={onRetry}
          >
            {won ? 'Jugar de nuevo' : 'Reintentar'}
          </button>
          <button
            id="result-back-btn"
            className="btn btn-ghost"
            onClick={onBack}
          >
            Volver al inicio
          </button>
        </div>
      </div>
    </div>
  );
}
