import React, { useState } from 'react';
import { getAbandonedTitle } from '../lib/resultMessages.js';
import { LEADERBOARD_NAME_MAX_LENGTH } from '../lib/constants.js';
import { addScore } from '../lib/leaderboard.js';
import './ResultScreen.css';
import './SimonResultScreen.css';

const REWARD_COPY = {
  pen: { icon: '🖊️', label: '¡Ganaste una lapicera!' },
  sticker: { icon: '⭐', label: '¡Ganaste un sticker!' },
};

/**
 * SimonResultScreen
 * Shown when a "Simón Dice" round finishes — either by completing the
 * sequence or by the player choosing to stop. Always a score, never a
 * "caught" framing.
 */
export default function SimonResultScreen({
  score, completedCount, totalCommands, rewardUnlocked, abandoned, onFinish,
}) {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  const reward = rewardUnlocked ? REWARD_COPY[rewardUnlocked] : null;

  const title = abandoned
    ? getAbandonedTitle()
    : reward
      ? reward.label
      : '¡Buena partida!';

  const handleSave = () => {
    if (!name.trim()) return;
    addScore('simon', name, score);
    setSaved(true);
  };

  const leaderboardSave = (
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
            id="simon-result-save-score-btn"
            className="btn btn-ghost"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            Guardar puntaje
          </button>
        </>
      )}
    </div>
  );

  // This mode never "loses" — a round always ends with a score, so the
  // worst case is neutral (blue), never the freeze game's red/shake.
  return (
    <div className={`result-screen ${reward ? 'result-won' : 'result-neutral'}`} id="simon-result-screen">
      <div className="result-card glass animate-fadeInScale">
        <div className={`result-mark ${reward ? 'result-mark-won' : 'result-mark-neutral'}`}>
          <span className="src-mark-icon" aria-hidden="true">{reward ? reward.icon : '🎯'}</span>
        </div>

        <h1 className="result-title">{title}</h1>

        <p className="result-subtitle">
          Completaste {completedCount} de {totalCommands} comandos.
        </p>

        <p className="result-duration">
          <strong>{score}</strong>
          <span> puntos</span>
        </p>

        {leaderboardSave}

        <div className="result-actions">
          <button
            id="simon-result-finish-btn"
            className={`btn btn-lg ${reward ? 'btn-success' : 'btn-primary'}`}
            onClick={onFinish}
          >
            Terminar
          </button>
        </div>
      </div>
    </div>
  );
}
