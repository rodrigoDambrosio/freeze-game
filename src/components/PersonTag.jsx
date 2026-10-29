import React from 'react';
import { isLandmarkUsable } from '../lib/poseAnalyzer.js';
import './PersonTag.css';

const MOTION_LINES = {
  left: { icon: '🚶', label: '← caminando' },
  right: { icon: '🚶', label: 'caminando →' },
  still: { icon: '🧍', label: 'quieto' },
};

const NOSE = 0;
const L_SHOULDER = 11;
const R_SHOULDER = 12;

/** Head position in on-screen 0..1 coords (mirrored or direct), or null. */
function headAnchor(landmarks, mirrorVideo = true) {
  if (!landmarks) return null;
  const mapX = (x) => (mirrorVideo ? 1 - x : x);
  const nose = landmarks[NOSE];
  if (isLandmarkUsable(nose, NOSE)) return { x: mapX(nose.x), y: nose.y };
  const ls = landmarks[L_SHOULDER];
  const rs = landmarks[R_SHOULDER];
  if (isLandmarkUsable(ls, L_SHOULDER) && isLandmarkUsable(rs, R_SHOULDER)) {
    return { x: mapX((ls.x + rs.x) / 2), y: Math.min(ls.y, rs.y) };
  }
  return null;
}

/**
 * PersonTag
 *
 * A HUD-style tag that follows a passer-by's head and lists what the system
 * is reading about them right now — a description, never an instruction.
 * Must be rendered inside the visible-video rect (CameraView's stage) so its
 * percentage coordinates line up with the landmarks.
 */
export default function PersonTag({ observation, landmarks, mirrorVideo = true }) {
  const anchor = headAnchor(landmarks, mirrorVideo);
  if (!observation || !anchor) return null;

  // Beside the head, on whichever side has more room.
  const onLeft = anchor.x > 0.62;
  const style = {
    top: `${Math.min(Math.max(anchor.y * 100, 4), 70)}%`,
    left: `${anchor.x * 100}%`,
  };

  const lines = [];
  const motion = MOTION_LINES[observation.motion];
  if (motion) lines.push({ id: 'motion', ...motion });
  for (const tag of observation.tags) {
    lines.push({ ...tag, label: tag.percent != null ? `${tag.label} ${tag.percent}%` : tag.label });
  }

  return (
    <div className={`person-tag ${onLeft ? 'person-tag-left' : 'person-tag-right'}`} style={style}>
      <span className="person-tag-header">
        <span className="person-tag-dot" aria-hidden="true" />
        PERSONA #{String(observation.personNumber).padStart(2, '0')}
      </span>
      {lines.map((line) => (
        <span key={line.id} className="person-tag-line animate-fadeIn">
          <span className="person-tag-icon" aria-hidden="true">{line.icon}</span>
          {line.label}
        </span>
      ))}
    </div>
  );
}
