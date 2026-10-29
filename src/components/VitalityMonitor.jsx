import React from 'react';
import {
  EXPRESSION_ACTIVE_STD,
  HEAD_MOTION_ACTIVE,
} from '../lib/constants.js';
import './VitalityMonitor.css';

/**
 * VitalityMonitor
 *
 * The scoreboard of the challenge, read from the player's side: each row is a
 * detector trying to prove they are alive. Green means that detector has
 * nothing — the player is winning that one. Red means it found them.
 *
 * Also displayed before the game starts (`isPreview = true`) so passers-by at
 * the stand can see the C.U.I.D.A. detectors reacting live to their movements,
 * blinks, and facial expressions as they walk past.
 */

function Detector({ label, found, value, hint, pending, disabled }) {
  const status = disabled ? 'disabled' : pending ? 'pending' : found ? 'found' : 'hidden';
  return (
    <div className={`vm-det vm-det-${status}`}>
      <span className="vm-det-dot" />
      <div className="vm-det-body">
        <span className="vm-det-label">{label}</span>
        <span className="vm-det-value">{disabled ? 'desactivado' : value}</span>
      </div>
      {hint && !disabled && <span className="vm-det-hint">{hint}</span>}
    </div>
  );
}

function Meter({ value, threshold }) {
  const ratio = threshold > 0 ? value / threshold : 0;
  const pct = Math.min(100, (ratio / 2) * 100);
  return (
    <div className="vm-meter">
      <div
        className={`vm-meter-fill ${ratio >= 1 ? 'vm-meter-over' : ''}`}
        style={{ width: `${pct}%` }}
      />
      <div className="vm-meter-mark" style={{ left: '50%' }} />
    </div>
  );
}

export default function VitalityMonitor({
  reading,
  faceLoading,
  gestureDrift = 0,
  gestureThreshold = 1,
  detectGestures = true,
  detectBlink = true,
  blinkCount = 0,
  blinkLimit = null,
  movementScore = 0,
  movementThreshold = 0.014,
  isPreview = false,
}) {
  if (faceLoading) {
    return (
      <div className="vm-panel">
        <div className="vm-head"><span className="vm-title">Detectores</span></div>
        <div className="vm-loading">
          <div className="spinner spinner-sm" />
          <span>Cargando modelo facial…</span>
        </div>
      </div>
    );
  }

  const expression = reading?.expressionActivity ?? 0;
  const head = reading?.headActivity ?? 0;

  const blinkFound = isPreview
    ? (reading?.lastBlinkAgo != null && reading.lastBlinkAgo < 800)
    : (blinkLimit !== null && blinkCount > blinkLimit);
  const gestureFound = gestureDrift > gestureThreshold;
  const headFound = head > HEAD_MOTION_ACTIVE;
  const expressionFound = expression > EXPRESSION_ACTIVE_STD;
  const bodyFound = movementScore > movementThreshold;

  // How many detectors currently have the player. Zero is what wins.
  const found = [
    detectBlink && blinkFound,
    detectGestures && gestureFound,
    headFound,
    isPreview && expressionFound,
    isPreview && bodyFound,
  ].filter(Boolean).length;

  return (
    <div className={`vm-panel ${!isPreview && found > 0 ? 'vm-panel-alert' : ''}`}>
      <div className="vm-head">
        <span className="vm-title">{isPreview ? 'Sensores en vivo' : 'Detectores'}</span>
        <span className={`vm-count ${found === 0 ? 'vm-count-clear' : ''}`}>
          {found === 0 ? 'ninguno te ve' : `${found} te detecta${found > 1 ? 'n' : ''}`}
        </span>
      </div>

      <div className="vm-signals">
        <Detector
          label="Parpadeo"
          disabled={!detectBlink}
          found={blinkFound}
          value={
            !isPreview && blinkLimit !== null && blinkLimit > 0
              ? `${blinkCount} / ${blinkLimit}`
              : blinkCount > 0 ? String(blinkCount) : 'ninguno'
          }
          hint={!isPreview && blinkFound ? 'te delató' : null}
        />

        <div className="vm-signal-extra">
          <Detector
            label="Gesto facial"
            disabled={!detectGestures}
            found={gestureFound}
            value={gestureDrift.toFixed(3)}
            hint={!isPreview && gestureFound ? 'te delató' : null}
          />
          {detectGestures && <Meter value={gestureDrift} threshold={gestureThreshold} />}
        </div>

        <div className="vm-signal-extra">
          <Detector
            label="Micromovimiento"
            found={headFound}
            value={head.toFixed(4)}
            hint={!isPreview && headFound ? 'te delató' : null}
          />
          <Meter value={head} threshold={HEAD_MOTION_ACTIVE} />
        </div>

        <div className="vm-signal-extra">
          <Detector
            label="Expresión"
            found={expressionFound}
            value={expression.toFixed(4)}
          />
          <Meter value={expression} threshold={EXPRESSION_ACTIVE_STD} />
        </div>

        <div className="vm-signal-extra">
          <Detector
            label="Cuerpo"
            found={bodyFound}
            value={movementScore.toFixed(3)}
          />
          <Meter value={movementScore} threshold={movementThreshold} />
        </div>
      </div>
    </div>
  );
}
