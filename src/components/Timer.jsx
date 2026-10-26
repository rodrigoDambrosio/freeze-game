import React, { useRef } from 'react';
import './Timer.css';

const CIRCUMFERENCE = 2 * Math.PI * 44; // r=44

/**
 * Timer — circular countdown with SVG progress ring.
 * Colors shift from signal-blue → amber → red as time runs low.
 */
export default function Timer({ timeLeft, totalSeconds }) {
  const ringRef = useRef(null);
  const progress = Math.max(0, timeLeft / totalSeconds);
  const offset = CIRCUMFERENCE * (1 - progress);

  const color =
    progress > 0.6 ? '#5b9cf5'
    : progress > 0.3 ? '#e8aa42'
    : '#e05c5c';

  const glowColor =
    progress > 0.6 ? 'rgba(91,156,245,0.35)'
    : progress > 0.3 ? 'rgba(232,170,66,0.35)'
    : 'rgba(224,92,92,0.35)';

  return (
    <div className="timer-wrap" id="game-timer">
      <svg className="timer-svg" viewBox="0 0 100 100">
        {/* Track */}
        <circle
          cx="50" cy="50" r="44"
          className="timer-track"
        />
        {/* Progress ring */}
        <circle
          ref={ringRef}
          cx="50" cy="50" r="44"
          className="timer-ring"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          style={{ stroke: color, filter: `drop-shadow(0 0 5px ${glowColor})` }}
        />
      </svg>

      <div className="timer-content">
        <span className="timer-digits" style={{ color }}>
          {timeLeft}
        </span>
        <span className="timer-unit">s</span>
      </div>
    </div>
  );
}

