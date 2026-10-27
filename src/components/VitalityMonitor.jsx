import React from 'react';
import { VITALITY_STATE } from '../lib/vitalityAnalyzer.js';
import {
  BLINK_RATE_LOW,
  BLINK_RATE_NORMAL,
  EXPRESSION_ACTIVE_STD,
  HEAD_MOTION_ACTIVE,
  VITALITY_ALERT_MS,
} from '../lib/constants.js';
import './VitalityMonitor.css';

/**
 * VitalityMonitor
 *
 * The signs-of-life read-out. Each signal is shown with its own live value
 * rather than rolled into a single number, because which signal is missing is
 * the diagnostically useful part: a person who blinks but does not move is a
 * different situation from one who breathes but does nothing else.
 */

const STATE_COPY = {
  [VITALITY_STATE.NO_SIGNAL]: {
    title: 'Sin señal',
    detail: 'No se detecta ninguna persona en el encuadre.',
  },
  [VITALITY_STATE.ACTIVE]: {
    title: 'Persona activa',
    detail: 'Movimiento evidente. Sin observaciones.',
  },
  [VITALITY_STATE.CALM]: {
    title: 'En reposo',
    detail: 'Quieta, con signos de consciencia presentes.',
  },
  [VITALITY_STATE.STILL]: {
    title: 'Inmóvil',
    detail: 'Sin parpadeo ni gestos. Se mantiene señal corporal.',
  },
  [VITALITY_STATE.UNRESPONSIVE]: {
    title: 'Sin respuesta',
    detail: 'Sin signos de consciencia ni señal corporal periódica.',
  },
};

function Signal({ label, detected, value, hint, pending }) {
  const status = pending ? 'pending' : detected ? 'on' : 'off';
  return (
    <div className={`vm-signal vm-signal-${status}`}>
      <span className="vm-signal-dot" />
      <div className="vm-signal-body">
        <span className="vm-signal-label">{label}</span>
        <span className="vm-signal-value">{value}</span>
      </div>
      {hint && <span className="vm-signal-hint">{hint}</span>}
    </div>
  );
}

function Meter({ value, threshold }) {
  const pct = Math.min(100, threshold > 0 ? (value / (threshold * 3)) * 100 : 0);
  return (
    <div className="vm-meter">
      <div className="vm-meter-fill" style={{ width: `${pct}%` }} />
      <div
        className="vm-meter-mark"
        style={{ left: `${Math.min(100, (1 / 3) * 100)}%` }}
      />
    </div>
  );
}

export default function VitalityMonitor({
  reading, faceLoading, gestureDrift = 0, gestureThreshold = 1,
  detectGestures = true, isPlaying = false,
}) {
  if (faceLoading) {
    return (
      <div className="vm-panel">
        <div className="vm-head">
          <span className="vm-title">Monitor de signos vitales</span>
        </div>
        <div className="vm-loading">
          <div className="spinner spinner-sm" />
          <span>Cargando modelo facial…</span>
        </div>
      </div>
    );
  }

  const state = reading?.state ?? VITALITY_STATE.NO_SIGNAL;
  const copy = STATE_COPY[state];

  const blinkRate = reading?.blinkRate;
  const blinkDetected = blinkRate !== null && blinkRate !== undefined && blinkRate >= BLINK_RATE_LOW;
  const blinkPending = blinkRate === null || blinkRate === undefined;

  const expression = reading?.expressionActivity ?? 0;
  const head = reading?.headActivity ?? 0;

  const breathing = reading?.breathingDetected ?? false;
  const breathRate = reading?.breathingRate;
  const breathPending =
    (reading?.samples ?? 0) < (reading?.breathingWindowNeeded ?? Infinity);

  const stillSeconds = reading?.stillMs ? Math.floor(reading.stillMs / 1000) : 0;

  return (
    <div className={`vm-panel vm-state-${state.toLowerCase()}`}>
      <div className="vm-head">
        <span className="vm-title">Monitor de signos vitales</span>
        <span className="vm-chip">{reading?.fps ? `${Math.round(reading.fps)} fps` : '—'}</span>
      </div>

      <div className="vm-state">
        <span className="vm-state-dot" />
        <div>
          <div className="vm-state-title">{copy.title}</div>
          <div className="vm-state-detail">{copy.detail}</div>
        </div>
      </div>

      {state !== VITALITY_STATE.NO_SIGNAL && (
        <div className="vm-still">
          Sin signos de consciencia hace <strong>{stillSeconds}s</strong>
          <span className="vm-still-limit"> / alerta a los {VITALITY_ALERT_MS / 1000}s</span>
        </div>
      )}

      <div className="vm-signals">
        <Signal
          label="Parpadeo"
          detected={blinkDetected}
          pending={blinkPending}
          value={
            blinkPending
              ? 'midiendo…'
              : `${blinkRate.toFixed(0)} /min`
          }
          hint={
            blinkPending ? null
              : blinkRate >= BLINK_RATE_NORMAL ? 'normal'
              : blinkRate >= BLINK_RATE_LOW ? 'bajo'
              : 'ausente'
          }
        />

        <div className="vm-signal-extra">
          <Signal
            label="Expresión facial"
            detected={expression > EXPRESSION_ACTIVE_STD}
            value={expression.toFixed(4)}
          />
          <Meter value={expression} threshold={EXPRESSION_ACTIVE_STD} />
        </div>

        <div className="vm-signal-extra">
          <Signal
            label="Micromovimiento de cabeza"
            detected={head > HEAD_MOTION_ACTIVE}
            value={head.toFixed(4)}
          />
          <Meter value={head} threshold={HEAD_MOTION_ACTIVE} />
        </div>

        {isPlaying && detectGestures && (
          <div className="vm-signal-extra">
            <Signal
              label="Gesto facial"
              detected={gestureDrift <= gestureThreshold}
              value={gestureDrift.toFixed(3)}
              hint={gestureDrift > gestureThreshold ? 'infracción' : null}
            />
            <Meter value={gestureDrift} threshold={gestureThreshold} />
          </div>
        )}

        <Signal
          label="Respiración"
          detected={breathing}
          pending={breathPending}
          value={
            breathPending ? 'midiendo…'
              : breathing ? `${breathRate.toFixed(0)} /min`
              : 'no detectada'
          }
          hint={
            breathPending || !breathing
              ? null
              : `confianza ${(reading.breathingConfidence * 100).toFixed(0)}%`
          }
        />
      </div>

      <p className="vm-disclaimer">
        Demostración del enfoque de sensado. No es un dispositivo médico: la
        ausencia de una señal indica que la cámara no puede verla, lo que no
        equivale a su ausencia real.
      </p>
    </div>
  );
}
