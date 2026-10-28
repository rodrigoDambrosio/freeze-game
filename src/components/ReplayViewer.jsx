import React, { useEffect, useMemo, useRef } from 'react';
import {
  drawReplaySkeleton,
  drawMotionTrail,
  drawFocusVignette,
  drawDisplacementVectors,
  applyZoom,
  centroidOf,
  findMostMovedLandmark,
} from '../lib/replayDrawing.js';
import {
  ZONE_LANDMARK_INDICES,
  REPLAY_PLAYBACK_RATE,
  REPLAY_HOLD_MS,
  REPLAY_ZOOM_SCALE,
  REPLAY_ZONE_COLOR,
  REPLAY_GHOST_COLOR,
} from '../lib/constants.js';
import './ReplayViewer.css';

const CANVAS_W = 640;
const DEFAULT_ASPECT = 3 / 4;

/** Ease-out so the push-in decelerates into the held frame. */
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * ReplayViewer
 *
 * Replays the seconds before the detection in two beats:
 *
 *  1. Slow motion — the footage, a dashed "ghost" of the starting pose, and
 *     the live skeleton with the telltale zone tinted.
 *  2. Hold — the view pushes in on what gave the player away and draws arrows
 *     from the starting pose to where each joint actually ended up.
 *
 * The second beat is what makes the replay mean anything: a player who looks
 * perfectly still on video is only caught by a displacement of a few dozen
 * pixels, and at full frame that reads as nothing at all.
 *
 * Nothing here is stored or sent anywhere — it only lives in this tab.
 */
export default function ReplayViewer({ frames, anchorLandmarks, activeZone, focusIndices }) {
  const canvasRef = useRef(null);
  const progressRef = useRef(null);

  const canvasH = useMemo(() => {
    const img = frames?.find((f) => f.frameImage)?.frameImage;
    const aspect = img ? img.height / img.width : DEFAULT_ASPECT;
    return Math.round(CANVAS_W * aspect);
  }, [frames]);

  // Which landmarks the detection was actually about: a body zone for a
  // movement call, the eyes or mouth for a facial one.
  const subjectIndices = useMemo(() => (
    activeZone ? (ZONE_LANDMARK_INDICES[activeZone] ?? []) : (focusIndices ?? [])
  ), [activeZone, focusIndices]);

  const haloLandmarkIdx = useMemo(() => {
    if (!activeZone || !anchorLandmarks || !frames?.length) return null;
    const last = [...frames].reverse().find((f) => f.landmarks)?.landmarks;
    const best = findMostMovedLandmark(last, anchorLandmarks, ZONE_LANDMARK_INDICES[activeZone] ?? []);
    return best ? best.idx : null;
  }, [frames, anchorLandmarks, activeZone]);

  const spanSeconds = useMemo(() => {
    if (!frames || frames.length < 2) return null;
    return (frames[frames.length - 1].t - frames[0].t) / 1000;
  }, [frames]);

  // The telltale point sampled across the whole window. One entry per frame so
  // the trail can be revealed in step with the footage.
  const trailPoints = useMemo(() => {
    if (!frames?.length) return [];
    const points = [];
    for (const f of frames) {
      if (!f.landmarks) continue;
      const point = haloLandmarkIdx != null
        ? f.landmarks[haloLandmarkIdx]
        : (subjectIndices.length ? centroidOf(f.landmarks, subjectIndices) : null);
      if (!point) continue;
      if ((point.visibility ?? 1) < 0.5) continue;
      points.push({ x: point.x, y: point.y });
    }
    return points;
  }, [frames, haloLandmarkIdx, subjectIndices]);

  useEffect(() => {
    if (!frames || frames.length < 2) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = CANVAS_W;
    const H = canvasH;

    const t0 = frames[0].t;
    const totalDuration = Math.max(1, frames[frames.length - 1].t - t0);
    const playLen = totalDuration / REPLAY_PLAYBACK_RATE;
    const cycleLen = playLen + REPLAY_HOLD_MS;
    const loopStart = performance.now();

    let rafId;
    const draw = () => {
      const now = performance.now();
      const elapsed = (now - loopStart) % cycleLen;
      const holding = elapsed >= playLen;
      const targetT = Math.min(elapsed * REPLAY_PLAYBACK_RATE, totalDuration);

      let frame = frames[frames.length - 1];
      let frameIdx = frames.length - 1;
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].t - t0 >= targetT) {
          frame = frames[i];
          frameIdx = i;
          break;
        }
      }

      const lms = frame.landmarks;

      // Where the detection happened, so the trail, the vignette and the
      // push-in all agree on one point.
      let focusCenter = trailPoints.length ? trailPoints[trailPoints.length - 1] : null;
      if (!focusCenter && lms) {
        focusCenter = activeZone
          ? centroidOf(lms, ZONE_LANDMARK_INDICES[activeZone] ?? [])
          : (focusIndices?.length ? centroidOf(lms, focusIndices) : null);
      }

      const holdProgress = holding
        ? Math.min(1, (elapsed - playLen) / (REPLAY_HOLD_MS * 0.55))
        : 0;
      const zoom = 1 + (REPLAY_ZOOM_SCALE - 1) * easeOut(holdProgress);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (holding && focusCenter) applyZoom(ctx, focusCenter, zoom, W, H);

      if (frame.frameImage) {
        ctx.drawImage(frame.frameImage, 0, 0, W, H);
        // Dim the footage so the overlay stays legible on top, and dim it
        // further on the hold so the arrows carry the frame.
        ctx.fillStyle = holding
          ? `rgba(5, 7, 13, ${0.3 + 0.28 * holdProgress})`
          : 'rgba(5, 7, 13, 0.3)';
        ctx.fillRect(0, 0, W, H);
      }

      // Pull the eye to the detection without covering it. Only on the hold,
      // so the first pass still reads as plain footage.
      if (holding) {
        drawFocusVignette(ctx, focusCenter, W, H, 0.72 * easeOut(holdProgress));
      }

      if (anchorLandmarks) {
        drawReplaySkeleton(ctx, anchorLandmarks, W, H, REPLAY_GHOST_COLOR, {
          dashed: true,
          alpha: holding ? 0.65 : 0.4,
          lineWidth: 2,
        });
      }

      // The path travelled so far, revealed in step with the footage.
      drawMotionTrail(
        ctx, trailPoints, W, H, REPLAY_ZONE_COLOR,
        holding ? trailPoints.length : frameIdx + 1,
      );

      if (lms) {
        drawReplaySkeleton(ctx, lms, W, H, '#5b9cf5', {
          activeZone,
          zoneColor: REPLAY_ZONE_COLOR,
          alpha: 0.85,
        });

        // The evidence, faded in once the push-in has started.
        if (holding && anchorLandmarks) {
          drawDisplacementVectors(
            ctx, lms, anchorLandmarks, W, H,
            subjectIndices, REPLAY_ZONE_COLOR, easeOut(holdProgress),
          );
        }
      }

      ctx.restore();

      if (progressRef.current) {
        const pct = holding ? 100 : (elapsed / playLen) * 100;
        progressRef.current.style.width = `${pct}%`;
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [frames, anchorLandmarks, activeZone, focusIndices, subjectIndices, trailPoints, canvasH]);

  if (!frames || frames.length < 2) return null;

  return (
    <div className="replay-viewer glass">
      <div className="replay-viewer-label">
        {spanSeconds != null
          ? `Últimos ${spanSeconds.toFixed(1)} s antes de la detección`
          : 'Repetición'}
      </div>

      <canvas ref={canvasRef} width={CANVAS_W} height={canvasH} className="replay-canvas" />

      <div className="replay-timeline">
        <div className="replay-timeline-track">
          <div ref={progressRef} className="replay-timeline-fill" />
        </div>
        <span className="replay-timeline-end">detectado</span>
      </div>

      <div className="replay-legend">
        <span className="replay-legend-item">
          <span className="replay-legend-swatch replay-legend-ghost" />
          posición inicial
        </span>
        <span className="replay-legend-item">
          <span className="replay-legend-swatch replay-legend-moved" />
          tu recorrido real
        </span>
      </div>
    </div>
  );
}
