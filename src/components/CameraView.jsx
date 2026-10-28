import React, { useRef, useEffect, useCallback } from 'react';
import { BOX_COLORS } from '../lib/constants.js';
import { getLandmarkBoundingBox, drawSkeleton } from '../lib/poseAnalyzer.js';
import { useLetterboxRect } from '../hooks/useLetterboxRect.js';
import './CameraView.css';

/**
 * CameraView
 *
 * Renders the camera video + canvas overlay.
 * Draws:
 *  - Mirrored video feed (selfie-style)
 *  - Bounding box around the detected person
 *  - Skeleton keypoints
 *  - Corner bracket decorations (HUD-style)
 */
export default function CameraView({
  videoRef,
  stream,
  onVideoReady,
  landmarks,
  gameState,
  movementScore,
  sensitivityThreshold,
  onStageRectChange,
}) {
  const localVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // The full capture is always shown (object-fit: contain) — this is the
  // visible video rect within the container, so HUD elements never sit over
  // the black letterbox bars that appear when aspect ratios don't match.
  const stageInset = useLetterboxRect(containerRef, localVideoRef, stream);

  // Sync node reference with parent ref
  const setVideoRef = useCallback(
    (node) => {
      localVideoRef.current = node;
      if (typeof videoRef === 'function') {
        videoRef(node);
      } else if (videoRef && 'current' in videoRef) {
        videoRef.current = node;
      }
    },
    [videoRef]
  );

  // ── Attach stream to video element when available ────────────────────────
  useEffect(() => {
    const video = localVideoRef.current;
    if (!video || !stream) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    let isMounted = true;
    const handleReady = async () => {
      try {
        await video.play();
        if (isMounted && onVideoReady) {
          onVideoReady();
        }
      } catch (err) {
        console.warn('Video playback warning:', err);
      }
    };

    if (video.readyState >= 1) {
      handleReady();
    } else {
      video.addEventListener('loadedmetadata', handleReady);
      return () => {
        isMounted = false;
        video.removeEventListener('loadedmetadata', handleReady);
      };
    }
  }, [stream, onVideoReady]);

  const getBoxColor = useCallback(() => {
    return BOX_COLORS[gameState?.toLowerCase()] ?? BOX_COLORS.detecting;
  }, [gameState]);

  // ── Draw overlay on each frame ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    let rafId;

    const draw = () => {
      const W = video.videoWidth || canvas.width || 640;
      const H = video.videoHeight || canvas.height || 480;

      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);

      // Mirror transform (canvas is flipped via CSS, so we draw normally)
      const color = getBoxColor();

      if (landmarks) {
        // Skeleton is hidden once the round starts — the player should feel
        // watched, not debug how the detector sees them. It resurfaces in the
        // loss replay instead.
        if (gameState !== 'PLAYING') {
          drawSkeleton(ctx, landmarks, W, H, color);
        }

        // Draw bounding box
        const box = getLandmarkBoundingBox(landmarks, W, H, 24);
        if (box) {
          drawDetectionBox(ctx, box, color, gameState);
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [landmarks, gameState, getBoxColor, videoRef]);

  // Share the visible-video rect with the parent so its own HUD (badge,
  // timer, buttons) can be confined to the same area.
  useEffect(() => {
    onStageRectChange?.(stageInset);
  }, [stageInset, onStageRectChange]);

  return (
    <div className="camera-view" ref={containerRef}>
      <video
        ref={setVideoRef}
        id="camera-video"
        className="camera-video"
        autoPlay
        playsInline
        muted
      />
      <canvas
        ref={canvasRef}
        id="camera-canvas"
        className="camera-canvas"
      />

      {/* Confined to the visible video rect — never drawn over the black
          letterbox bars that object-fit: contain can leave on the sides. */}
      <div
        className="camera-stage"
        style={{
          top: stageInset.top,
          right: stageInset.right,
          bottom: stageInset.bottom,
          left: stageInset.left,
        }}
      >
        {/* HUD corner decorators */}
        <div className="hud-corners">
          <span className="hud-corner tl" />
          <span className="hud-corner tr" />
          <span className="hud-corner bl" />
          <span className="hud-corner br" />
        </div>

        {/* Scanning sweep while searching for the player. The HUD badge is the
            only place that says so in words. */}
        {gameState === 'DETECTING' && (
          <div className="camera-status-overlay">
            <div className="scanning-line" />
          </div>
        )}

        {/* Movement bar (visible only during PLAYING) */}
        {gameState === 'PLAYING' && (
          <div className="movement-bar-wrap">
            <div className="movement-bar-label">Movimiento</div>
            <div className="movement-bar-track">
              <div
                className="movement-bar-fill"
                style={{
                  width: `${Math.min(100, (movementScore / (sensitivityThreshold * 2)) * 100)}%`,
                  background: movementScore > sensitivityThreshold
                    ? 'var(--accent-red)'
                    : movementScore > sensitivityThreshold * 0.6
                    ? 'var(--accent-yellow)'
                    : 'var(--accent-green)',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Canvas drawing helpers ──────────────────────────────────────────────────

function drawDetectionBox(ctx, box, color, gameState) {
  const { x, y, width, height } = box;
  const r = 10; // corner radius
  const cornerLen = Math.min(width, height) * 0.2;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.9;

  // Rounded rectangle (full box, low opacity)
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = color;
  roundRect(ctx, x, y, width, height, r);
  ctx.fill();

  // Corner brackets
  ctx.globalAlpha = 1;
  ctx.lineWidth = 3;

  // Top-left
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + cornerLen, y);
  ctx.moveTo(x, y + r);
  ctx.lineTo(x, y + cornerLen);
  ctx.stroke();

  // Top-right
  ctx.beginPath();
  ctx.moveTo(x + width - cornerLen, y);
  ctx.lineTo(x + width - r, y);
  ctx.moveTo(x + width, y + r);
  ctx.lineTo(x + width, y + cornerLen);
  ctx.stroke();

  // Bottom-left
  ctx.beginPath();
  ctx.moveTo(x, y + height - cornerLen);
  ctx.lineTo(x, y + height - r);
  ctx.moveTo(x + r, y + height);
  ctx.lineTo(x + cornerLen, y + height);
  ctx.stroke();

  // Bottom-right
  ctx.beginPath();
  ctx.moveTo(x + width - cornerLen, y + height);
  ctx.lineTo(x + width - r, y + height);
  ctx.moveTo(x + width, y + height - cornerLen);
  ctx.lineTo(x + width, y + height - r);
  ctx.stroke();

  // Glow effect on active game
  if (gameState === 'PLAYING') {
    ctx.globalAlpha = 0.15;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    roundRect(ctx, x, y, width, height, r);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
