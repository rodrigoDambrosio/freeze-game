import React, { useEffect, useMemo, useState } from 'react';
import { readLeaderboard, subscribeLeaderboard } from '../lib/leaderboard.js';
import { formatSurvived } from '../lib/resultMessages.js';
import './IdleAttractScreen.css';

function formatValue(mode, value) {
  if (mode === 'simon') return `${Math.round(value)}`;
  return formatSurvived(value);
}

/**
 * IdleAttractScreen
 *
 * Shown over the camera feed whenever nobody is mid-round: the leaderboard
 * for whichever mode is configured. (The tag describing passers-by is drawn
 * by CameraView, since it has to follow them.)
 */
export default function IdleAttractScreen({ gameMode }) {
  // Bumped whenever another tab saves a score, so the leaderboard re-reads —
  // the effect only ever reacts to that external event, never writes state
  // synchronously on its own.
  const [version, setVersion] = useState(0);

  useEffect(() => subscribeLeaderboard(gameMode, () => setVersion((v) => v + 1)), [gameMode]);

  const entries = useMemo(() => readLeaderboard(gameMode), [gameMode, version]); // eslint-disable-line react-hooks/exhaustive-deps -- `version` only forces a re-read, it is not used in the body

  const unit = gameMode === 'simon' ? 'pts' : 's';

  return (
    <div className="ias-wrap">
      <div className="ias-leaderboard glass">
        <span className="ias-leaderboard-title">Mejores puntajes</span>
        {entries.length === 0 ? (
          <p className="ias-leaderboard-empty">Todavía nadie jugó</p>
        ) : (
          <ol className="ias-leaderboard-list">
            {entries.map((entry, i) => (
              <li key={`${entry.name}-${entry.ts}`} className="ias-leaderboard-row">
                <span className="ias-rank">{i + 1}</span>
                <span className="ias-name">{entry.name}</span>
                <span className="ias-value">{formatValue(gameMode, entry.value)}{unit}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
