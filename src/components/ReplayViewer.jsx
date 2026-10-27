import React, { useEffect, useMemo, useRef } from 'react';
import {
  drawReplaySkeleton,
  drawPulsingHalo,
  centroidOf,
  findMostMovedLandmark,
} from '../lib/replayDrawing.js';
import {
  ZONE_LANDMARK_INDICES,
  REPLAY_PLAYBACK_RATE,
  REPLAY_HOLD_MS,
  REPLAY_ZONE_COLOR,
  REPLAY_GHOST_COLOR,
} from '../lib/constants.js';
import './ReplayViewer.css';

const CANVAS_W = 640;
const DEFAULT_ASPECT = 3 / 4;

/**
 * ReplayViewer
 *
 * Loops the seconds captured right before the detection, in slow motion:
 *  - the real camera footage in the background
 *  - a translucent "ghost" of the starting pose for reference
 *  - the current skeleton, with the zone that moved tinted
 *  - a pulsing halo on what gave the player away (the joint that moved most,
 *    or the eyes / mouth / shoulders for face and breathing signals)
 *
 * Nothing here is stored or sent anywhere — it only lives in this tab.
 */
export default function ReplayViewer({ frames, anchorLandmarks, activeZone, focusIndices, label }) {
  const canvasRef = useRef(null);

  const canvasH = useMemo(() => {
    const img = frames?.find((f) => f.frameImage)?.frameImage;
    const aspect = img ? img.height / img.width : DEFAULT_ASPECT;
    return Math.round(CANVAS_W * aspect);
  }, [frames]);

  const haloLandmarkIdx = useMemo(() => {
    if (!activeZone || !anchorLandmarks || !frames?.length) return null;
    const last = [...frames].reverse().find((f) => f.landmarks)?.landmarks;
    const best = findMostMovedLandmark(last, anchorLandmarks, ZONE_LANDMARK_INDICES[activeZone] ?? []);
    return best ? best.idx : null;
  }, [frames, anchorLandmarks, activeZone]);

  useEffect(() => {
    if (!frames || frames.length < 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = CANVAS_W;
    const H = canvasH;

    const t0 = frames[0].t;
    const totalDuration = Math.max(1, frames[frames.length - 1].t - t0);
    const cycleLen = totalDuration / REPLAY_PLAYBACK_RATE + REPLAY_HOLD_MS;
    const loopStart = performance.now();

    let rafId;
    const draw = () => {
      const now = performance.now();
      const elapsed = (now - loopStart) % cycleLen;
      const targetT = Math.min(elapsed * REPLAY_PLAYBACK_RATE, totalDuration);

      let frame = frames[frames.length - 1];
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].t - t0 >= targetT) {
          frame = frames[i];
          break;
        }
      }

      ctx.clearRect(0, 0, W, H);

      if (frame.frameImage) {
        ctx.drawImage(frame.frameImage, 0, 0, W, H);
        // Dim the footage slightly so the overlay stays legible on top
        ctx.fillStyle = 'rgba(5, 7, 13, 0.3)';
        ctx.fillRect(0, 0, W, H);
      }

      if (anchorLandmarks) {
        drawReplaySkeleton(ctx, anchorLandmarks, W, H, REPLAY_GHOST_COLOR, {
          dashed: true,
          alpha: 0.4,
          lineWidth: 2,
        });
      }

      const lms = frame.landmarks;
      let haloCenter = null;
      if (lms && activeZone) {
        const tracked = haloLandmarkIdx != null ? lms[haloLandmarkIdx] : null;
        haloCenter = tracked && (tracked.visibility ?? 1) >= 0.35
          ? tracked
          : centroidOf(lms, ZONE_LANDMARK_INDICES[activeZone] ?? []);
      } else if (lms && focusIndices?.length) {
        haloCenter = centroidOf(lms, focusIndices);
      }
      drawPulsingHalo(ctx, haloCenter, W, H, REPLAY_ZONE_COLOR, now);

      if (lms) {
        drawReplaySkeleton(ctx, lms, W, H, '#5b9cf5', {
          activeZone,
          zoneColor: REPLAY_ZONE_COLOR,
          alpha: 0.85,
        });
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [frames, anchorLandmarks, activeZone, focusIndices, haloLandmarkIdx, canvasH]);

  if (!frames || frames.length < 2) return null;

  return (
    <div className="replay-viewer glass">
      <div className="replay-viewer-label">
        <span className="replay-dot" />
        Repetición{label ? ` · ${label}` : ''}
      </div>
      <canvas ref={canvasRef} width={CANVAS_W} height={canvasH} className="replay-canvas" />
    </div>
  );
}
