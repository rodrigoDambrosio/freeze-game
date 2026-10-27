import React from 'react';
import './DiagnosticPanel.css';

/**
 * DiagnosticPanel
 *
 * Live read-out of what the movement analyzer is actually measuring, so a
 * false "you moved" can be traced to the zone and the landmarks that caused
 * it instead of being guessed at. Toggled with the D key; off by default.
 */

const LANDMARK_NAMES = {
  0: 'nariz', 1: 'ojo izq', 4: 'ojo der', 7: 'oreja izq', 8: 'oreja der',
  11: 'hombro izq', 12: 'hombro der', 13: 'codo izq', 14: 'codo der',
  15: 'muñeca izq', 16: 'muñeca der', 23: 'cadera izq', 24: 'cadera der',
  25: 'rodilla izq', 26: 'rodilla der', 27: 'tobillo izq', 28: 'tobillo der',
};

const ZONE_LABELS = { head: 'Cabeza', torso: 'Torso', arms: 'Brazos', legs: 'Piernas' };

function Bar({ value, threshold }) {
  const ratio = threshold > 0 ? value / threshold : 0;
  const pct = Math.min(100, ratio * 100);
  const state = ratio >= 1 ? 'over' : ratio >= 0.6 ? 'near' : 'ok';
  return (
    <div className="diag-bar-track">
      <div className={`diag-bar-fill diag-bar-${state}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ZoneRow({ zone, value, threshold, count }) {
  const ratio = threshold > 0 ? value / threshold : 0;
  return (
    <div className="diag-row">
      <span className="diag-zone">{ZONE_LABELS[zone] ?? zone}</span>
      <Bar value={value} threshold={threshold} />
      <span className={`diag-num ${ratio >= 1 ? 'diag-num-over' : ''}`}>
        {value.toFixed(4)}
      </span>
      {count !== undefined && <span className="diag-count">{count}pt</span>}
    </div>
  );
}

export default function DiagnosticPanel({ diagnostics, sensitivity }) {
  if (!diagnostics) {
    return (
      <div className="diag-panel">
        <div className="diag-title">Diagnóstico</div>
        <p className="diag-empty">Esperando la partida…</p>
      </div>
    );
  }

  const {
    zoneScores, driftScores, validCounts, excludedLandmarks, bodyScale,
    frameCount, breachFrames, dynamicThreshold, anchorThreshold, isValid,
    score, anchorDrift,
  } = diagnostics;

  return (
    <div className="diag-panel">
      <div className="diag-title">
        Diagnóstico
        <span className="diag-badge">{sensitivity}</span>
      </div>

      <div className="diag-meta">
        <span>escala <strong>{bodyScale?.toFixed(2) ?? '—'}</strong></span>
        <span>cuadro <strong>{frameCount}</strong></span>
        <span className={isValid ? '' : 'diag-warm'}>
          {isValid ? 'midiendo' : 'calibrando'}
        </span>
        <span className={breachFrames > 0 ? 'diag-num-over' : ''}>
          infracción {breachFrames}/4
        </span>
      </div>

      <div className="diag-section">Velocidad · umbral {dynamicThreshold}</div>
      {zoneScores && Object.keys(ZONE_LABELS).map((z) => (
        zoneScores[z] !== undefined && (
          <ZoneRow key={z} zone={z} value={zoneScores[z]} threshold={dynamicThreshold} />
        )
      ))}
      <div className="diag-row diag-row-total">
        <span className="diag-zone">pico</span>
        <Bar value={score} threshold={dynamicThreshold} />
        <span className="diag-num">{score.toFixed(4)}</span>
      </div>

      <div className="diag-section">Desvío de postura · umbral {anchorThreshold}</div>
      {driftScores
        ? ['head', 'torso', 'arms'].map((z) => (
            <ZoneRow
              key={z}
              zone={z}
              value={driftScores[z]}
              threshold={anchorThreshold}
              count={validCounts?.[z]}
            />
          ))
        : <p className="diag-empty">sin ancla todavía</p>}
      <div className="diag-row diag-row-total">
        <span className="diag-zone">pico</span>
        <Bar value={anchorDrift} threshold={anchorThreshold} />
        <span className="diag-num">{anchorDrift.toFixed(4)}</span>
      </div>

      <div className="diag-section">Puntos descartados por inestables</div>
      <p className="diag-excluded">
        {excludedLandmarks?.length
          ? excludedLandmarks.map((i) => LANDMARK_NAMES[i] ?? i).join(', ')
          : 'ninguno'}
      </p>
    </div>
  );
}
