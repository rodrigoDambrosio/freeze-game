import React, { useState } from 'react';
import ReplayViewer from './ReplayViewer.jsx';
import { getLostTitle, getAbandonedTitle, formatSurvived } from '../lib/resultMessages.js';
import { ABANDONED_REASON, LEADERBOARD_NAME_MAX_LENGTH } from '../lib/constants.js';
import { addScore } from '../lib/leaderboard.js';
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
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  const particles = won ? STATIC_PARTICLES : [];
  const isAbandoned = !won && infractionReason === ABANDONED_REASON;

  const survivedSeconds = !won && replayData?.survivedMs != null
    ? Math.max(0, Math.min(freezeSeconds, replayData.survivedMs / 1000))
    : null;

  const hasReplay = !won && !isAbandoned && replayData?.frames?.length > 1;

  // Leaderboard ranks "quedate quieto" by seconds survived — a full win
  // survives the whole round.
  const leaderboardValue = won ? freezeSeconds : survivedSeconds;

  const handleSave = () => {
    if (!name.trim() || leaderboardValue == null) return;
    addScore('freeze', name, leaderboardValue);
    setSaved(true);
  };

  const resultClass = won ? 'result-won' : isAbandoned ? 'result-neutral' : 'result-lost';

  return (
    <div className={`result-screen ${resultClass}`} id="result-screen">

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
      <div className={`result-card glass animate-fadeInScale ${hasReplay ? 'result-card-replay' : ''} ${!won && !isAbandoned ? 'animate-shake' : ''}`}>

        {/* Result mark — the replay takes its place when there is one */}
        {!hasReplay && (
          <div className={`result-mark ${won ? 'result-mark-won' : isAbandoned ? 'result-mark-neutral' : 'result-mark-lost'}`}>
            {won ? (
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Victoria">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : isAbandoned ? (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Ronda abandonada">
                <circle cx="12" cy="12" r="9" />
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
            : isAbandoned
              ? getAbandonedTitle()
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
        {!won && !isAbandoned && infractionReason && (
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

        {/* 5 — Optional: claim a spot on the waiting-screen leaderboard. */}
        {leaderboardValue != null && (
          <div className="result-leaderboard-save">
            {saved ? (
              <p className="result-saved-hint">¡Guardado en el ranking!</p>
            ) : (
              <>
                <input
                  type="text"
                  className="result-name-input"
                  placeholder="Tu nombre"
                  maxLength={LEADERBOARD_NAME_MAX_LENGTH}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <button
                  id="result-save-score-btn"
                  className="btn btn-ghost"
                  onClick={handleSave}
                  disabled={!name.trim()}
                >
                  Guardar puntaje
                </button>
              </>
            )}
          </div>
        )}

        {/* 6 — One way out: the stand moves on to the next participant. */}
        <div className="result-actions">
          <button
            id="result-finish-btn"
            className={`btn btn-lg ${won ? 'btn-success' : isAbandoned ? 'btn-primary' : 'btn-danger'}`}
            onClick={onFinish}
          >
            Terminar
          </button>
        </div>
      </div>
    </div>
  );
}
