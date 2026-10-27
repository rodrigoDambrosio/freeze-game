import React from 'react';
import { VITALITY_STATE } from '../lib/vitalityAnalyzer.js';
import {
  EXPRESSION_ACTIVE_STD,
  HEAD_MOTION_ACTIVE,
  BREATHING_AMPLITUDE_THRESHOLD,
} from '../lib/constants.js';
import './VitalityMonitor.css';

/**
 * VitalityMonitor
 *
 * The scoreboard of the challenge, read from the player's side: each row is a
 * detector trying to prove they are alive. Green means that detector has
 * nothing — the player is winning that one. Red means it found them.
 *
 * Each signal keeps its own row rather than being rolled into one number,
 * because which one gives a player away is the interesting part. Nearly
 * everyone can hold still; almost nobody can stop breathing.
 */

const STATE_COPY = {
  [VITALITY_STATE.NO_SIGNAL]: {
    title: 'Sin señal',
    detail: 'No hay nadie en el encuadre.',
  },
  [VITALITY_STATE.ACTIVE]: {
    title: 'Claramente con vida',
    detail: 'Movimiento evidente. Así es imposible.',
  },
  [VITALITY_STATE.CALM]: {
    title: 'Con vida',
    detail: 'El sistema sigue encontrando señales.',
  },
  [VITALITY_STATE.STILL]: {
    title: 'Casi indetectable',
    detail: 'Sin signos de consciencia. Queda la señal corporal.',
  },
  [VITALITY_STATE.UNRESPONSIVE]: {
    title: 'Indetectable',
    detail: 'El sistema no encuentra señales de vida.',
  },
};

/**
 * One detector's row.
 *
 * `found` is true when this detector has caught the player, which is the bad
 * outcome for them — so red means found, green means still hidden.
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
  reading, faceLoading, gestureDrift = 0, gestureThreshold = 1,
  detectGestures = true, detectBlink = true, detectBreathing = true,
  blinkCount = 0, blinkLimit = null,
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

  const state = reading?.state ?? VITALITY_STATE.NO_SIGNAL;
  const copy = STATE_COPY[state];

  const expression = reading?.expressionActivity ?? 0;
  const head = reading?.headActivity ?? 0;
  const breathAmp = reading?.breathAmplitude ?? 0;
  const breathFound = reading?.breathingDetected ?? false;
  const breathReady = reading?.breathingReady ?? false;

  const blinkFound = blinkLimit !== null && blinkCount > blinkLimit;
  const gestureFound = gestureDrift > gestureThreshold;
  const headFound = head > HEAD_MOTION_ACTIVE;

  // How many detectors currently have the player. Zero is what wins.
  const found = [
    detectBlink && blinkFound,
    detectGestures && gestureFound,
    detectBreathing && breathFound,
    headFound,
  ].filter(Boolean).length;

  return (
    <div className={`vm-panel vm-state-${state.toLowerCase()}`}>
      <div className="vm-head">
        <span className="vm-title">Detectores</span>
        <span className={`vm-count ${found === 0 ? 'vm-count-clear' : ''}`}>
          {found === 0 ? 'ninguno te ve' : `${found} te detecta${found > 1 ? 'n' : ''}`}
        </span>
      </div>

      <div className="vm-state">
        <span className="vm-state-dot" />
        <div>
          <div className="vm-state-title">{copy.title}</div>
          <div className="vm-state-detail">{copy.detail}</div>
        </div>
      </div>

      <div className="vm-signals">
        <Detector
          label="Parpadeo"
          disabled={!detectBlink}
          found={blinkFound}
          value={
            blinkLimit !== null && blinkLimit > 0
              ? `${blinkCount} / ${blinkLimit}`
              : blinkCount > 0 ? String(blinkCount) : 'ninguno'
          }
          hint={blinkFound ? 'te delató' : null}
        />

        <div className="vm-signal-extra">
          <Detector
            label="Gesto facial"
            disabled={!detectGestures}
            found={gestureFound}
            value={gestureDrift.toFixed(3)}
            hint={gestureFound ? 'te delató' : null}
          />
          {detectGestures && <Meter value={gestureDrift} threshold={gestureThreshold} />}
        </div>

        <div className="vm-signal-extra">
          <Detector
            label="Micromovimiento"
            found={headFound}
            value={head.toFixed(4)}
            hint={headFound ? 'te delató' : null}
          />
          <Meter value={head} threshold={HEAD_MOTION_ACTIVE} />
        </div>

        <div className="vm-signal-extra">
          <Detector
            label="Respiración"
            disabled={!detectBreathing}
            found={breathFound}
            pending={!breathReady}
            value={
              !breathReady ? 'midiendo…'
                : reading?.rateKnown ? `${reading.breathingRate.toFixed(0)} /min`
                : breathFound ? 'detectada'
                : 'no detectada'
            }
            hint={breathFound ? 'te delató' : null}
          />
          {detectBreathing && (
            <Meter value={breathAmp} threshold={BREATHING_AMPLITUDE_THRESHOLD} />
          )}
        </div>

        <div className="vm-signal-extra">
          <Detector
            label="Expresión"
            found={expression > EXPRESSION_ACTIVE_STD}
            value={expression.toFixed(4)}
          />
          <Meter value={expression} threshold={EXPRESSION_ACTIVE_STD} />
        </div>
      </div>

      <p className="vm-disclaimer">
        Estos mismos detectores, en C.U.I.D.A., avisan cuando una persona deja
        de dar señales. Es una demostración del enfoque de sensado, no un
        dispositivo médico.
      </p>
    </div>
  );
}
