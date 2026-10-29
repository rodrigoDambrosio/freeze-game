import React, { useRef, useEffect, useCallback } from 'react';
import { BOX_COLORS } from '../lib/constants.js';
import { drawSkeleton } from '../lib/poseAnalyzer.js';
import { useLetterboxRect } from '../hooks/useLetterboxRect.js';
import PersonTag from './PersonTag.jsx';
import './CameraView.css';

/**
 * CameraView
 *
 * Renders the camera/video feed + canvas overlay.
 * Supports both MediaStream (`stream`) and URL/Blob video sources (`videoSrc`),
 * optional mirroring (`mirrorVideo`), and draws the smoothed pose skeleton.
 */
export default function CameraView({
  videoRef,
  stream,
  videoSrc,
  videoLoop = true,
  mirrorVideo = true,
  onVideoReady,
  onVideoError,
  landmarks,
  gameState,
  observation,
  onStageRectChange,
}) {
  const localVideoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // The full capture is always shown (object-fit: contain) — this is the
  // visible video rect within the container, so HUD elements never sit over
  // the black letterbox bars that appear when aspect ratios don't match.
  const stageInset = useLetterboxRect(containerRef, localVideoRef, stream || videoSrc);

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

  // ── Attach MediaStream or videoSrc to video element when available ───────
  useEffect(() => {
    const video = localVideoRef.current;
    if (!video) return;
    if (!stream && !videoSrc) return;

    let isMounted = true;

    if (stream) {
      if (video.src) {
        video.removeAttribute('src');
      }
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
    } else if (videoSrc) {
      if (video.srcObject) {
        video.srcObject = null;
      }
      video.crossOrigin = 'anonymous';
      video.loop = videoLoop;
      if (video.getAttribute('src') !== videoSrc) {
        video.src = videoSrc;
      }
    }

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

    const handleError = () => {
      if (isMounted && onVideoError) {
        onVideoError();
      }
    };

    video.addEventListener('error', handleError);

    if (video.readyState >= 1) {
      handleReady();
    } else {
      video.addEventListener('loadedmetadata', handleReady);
    }

    return () => {
      isMounted = false;
      video.removeEventListener('loadedmetadata', handleReady);
      video.removeEventListener('error', handleError);
    };
  }, [stream, videoSrc, videoLoop, onVideoReady, onVideoError]);

  // Keep loop attribute updated live
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.loop = videoLoop;
    }
  }, [videoLoop]);

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

      if (landmarks) {
        drawSkeleton(ctx, landmarks, W, H, getBoxColor());
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [landmarks, getBoxColor, videoRef]);

  // Share the visible-video rect with the parent so its own HUD (badge,
  // timer, buttons) can be confined to the same area.
  useEffect(() => {
    onStageRectChange?.(stageInset);
  }, [stageInset, onStageRectChange]);

  const mirrorClass = mirrorVideo ? 'mirrored' : '';

  return (
    <div className="camera-view" ref={containerRef}>
      <video
        ref={setVideoRef}
        id="camera-video"
        className={`camera-video ${mirrorClass}`}
        autoPlay
        playsInline
        muted
        loop={videoLoop}
      />
      <canvas
        ref={canvasRef}
        id="camera-canvas"
        className={`camera-canvas ${mirrorClass}`}
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

        <PersonTag observation={observation} landmarks={landmarks} mirrorVideo={mirrorVideo} />
      </div>
    </div>
  );
}
