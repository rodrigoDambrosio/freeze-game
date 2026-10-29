import React from 'react';
import './SimonCommandPanel.css';

/**
 * SimonCommandPanel
 *
 * The instruction itself: big enough to read from across the stand, plus a
 * running score and a brief flash after each command resolves.
 */
export default function SimonCommandPanel({
  currentCommand, commandIndex, totalCommands, score, lastCommandResult, isHolding,
}) {
  if (!currentCommand) return null;

  return (
    <div className={`scp-panel ${isHolding ? 'scp-panel-holding' : ''}`}>
      <span className="scp-progress">
        Comando {commandIndex + 1} / {totalCommands}
      </span>

      <div className="scp-command">
        <span className="scp-icon" aria-hidden="true">{currentCommand.icon}</span>
        <span className="scp-label">{currentCommand.label}</span>
      </div>

      <span className={`scp-hint ${isHolding ? 'scp-hint-holding' : ''}`}>
        {isHolding ? '¡Así! Mantenelo…' : 'Esperando la postura…'}
      </span>

      <div className="scp-score">
        <span className="scp-score-value">{score}</span>
        <span className="scp-score-unit">pts</span>
      </div>

      {lastCommandResult && (
        <div
          key={lastCommandResult.key}
          className={`scp-flash animate-fadeIn ${lastCommandResult.success ? 'scp-flash-success' : 'scp-flash-timeout'}`}
        >
          {lastCommandResult.success ? `+${lastCommandResult.points}` : '¡Se acabó el tiempo!'}
        </div>
      )}
    </div>
  );
}
