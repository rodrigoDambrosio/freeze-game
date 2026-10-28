import React from 'react';
import ReplayViewer from './ReplayViewer.jsx';
import { getLostTitle, formatSurvived } from '../lib/resultMessages.js';
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
export default function ResultScreen({
  won, onFinish, freezeSeconds, infractionReason, replayData,
}) {
  const particles = won ? STATIC_PARTICLES : [];

  const survivedSeconds = !won && replayData?.survivedMs != null
    ? Math.max(0, Math.min(freezeSeconds, replayData.survivedMs / 1000))
    : null;

  const hasReplay = !won && replayData?.frames?.length > 1;

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
      <div className={`result-card glass animate-fadeInScale ${hasReplay ? 'result-card-replay' : ''} ${won ? '' : 'animate-shake'}`}>

        {/* Result mark — the replay takes its place when there is one */}
        {!hasReplay && (
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
        )}

        {/* 1 — How it went */}
        <h1 className="result-title">
          {won
            ? '¡Nos engañaste!'
            : survivedSeconds != null
              ? getLostTitle(survivedSeconds, freezeSeconds)
              : 'Te detectamos'}
        </h1>

        {/* 2 — How long they lasted */}
        {won ? (
          <p className="result-subtitle">
            {freezeSeconds} segundos sin una sola señal de vida. Reclamá tu premio.
          </p>
        ) : survivedSeconds != null && (
          <p className="result-duration">
            <strong>{formatSurvived(survivedSeconds)}s</strong>
            <span> de {freezeSeconds}</span>
          </p>
        )}

        {/* 3 — What gave them away. The reason already names the signal and
            the body zone, so nothing else on this screen repeats it. */}
        {!won && infractionReason && (
          <p className="result-caught">{infractionReason}</p>
        )}

        {/* 4 — What the camera saw in the seconds before the detection */}
        {hasReplay && (
          <ReplayViewer
            frames={replayData.frames}
            anchorLandmarks={replayData.anchorLandmarks}
            activeZone={replayData.activeZone}
            focusIndices={replayData.focusIndices}
          />
        )}

        {/* 5 — One way out: the stand moves on to the next participant. */}
        <div className="result-actions">
          <button
            id="result-finish-btn"
            className={`btn btn-lg ${won ? 'btn-success' : 'btn-danger'}`}
            onClick={onFinish}
          >
            Terminar
          </button>
        </div>
      </div>
    </div>
  );
}
