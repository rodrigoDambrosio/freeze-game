/**
 * usePoseDetection.js
 *
 * React hook wrapping MediaPipe Tasks-Vision PoseLandmarker.
 * Runs inference on each video frame via requestAnimationFrame.
 * Supports GPU with automatic CPU fallback, and ensures seamless startup.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { PoseLandmarker } from '@mediapipe/tasks-vision';
// Wasm runtime served from node_modules so it always matches the installed package version
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { MEDIAPIPE_MODEL_URL, MIN_POSE_CONFIDENCE } from '../lib/constants.js';

export function usePoseDetection(videoRef, canvasRef, isVideoReady) {
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);
  const lastTimestampRef = useRef(0);

  const [landmarks, setLandmarks] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Draw callback ref (so game logic can inject custom drawing)
  const onFrameRef = useRef(null);

  // ── Load MediaPipe model ────────────────────────────────────────────────
  const loadModel = useCallback(async () => {
    if (landmarkerRef.current) {
      setIsModelReady(true);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const vision = { wasmLoaderPath, wasmBinaryPath };

      try {
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MEDIAPIPE_MODEL_URL,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1, // single-person (most prominent)
          minPoseDetectionConfidence: MIN_POSE_CONFIDENCE,
          minPosePresenceConfidence: MIN_POSE_CONFIDENCE,
          minTrackingConfidence: MIN_POSE_CONFIDENCE,
        });
      } catch (gpuErr) {
        console.warn('GPU delegate failed for MediaPipe, falling back to CPU:', gpuErr);
        landmarkerRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MEDIAPIPE_MODEL_URL,
            delegate: 'CPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
          minPoseDetectionConfidence: MIN_POSE_CONFIDENCE,
          minPosePresenceConfidence: MIN_POSE_CONFIDENCE,
          minTrackingConfidence: MIN_POSE_CONFIDENCE,
        });
      }

      setIsModelReady(true);
    } catch (err) {
      console.error('MediaPipe load error:', err);
      setLoadError('No se pudo cargar el modelo de detección.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Inference loop ──────────────────────────────────────────────────────
  const startDetection = useCallback(() => {
    if (!landmarkerRef.current || !videoRef.current || !isVideoReady) return;
    setIsRunning(true);

    const loop = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;

      // Only run inference when video is actively playing and has advanced
      if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const now = performance.now();

        if (now > lastTimestampRef.current) {
          lastTimestampRef.current = now;
          try {
            const result = landmarker.detectForVideo(video, now);
            const lms = result.landmarks?.[0] ?? null; // first (most prominent) person
            setLandmarks(lms);

            if (onFrameRef.current) {
              onFrameRef.current(lms, video);
            }
          } catch {
            // Suppress frame inference errors
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [videoRef, isVideoReady]);

  const stopDetection = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsRunning(false);
    setLandmarks(null);
  }, []);

  // ── Auto-start when video and model are ready ───────────────────────────
  useEffect(() => {
    if (isVideoReady && isModelReady && !isRunning) {
      startDetection();
    } else if (!isVideoReady && isRunning) {
      stopDetection();
    }
  }, [isVideoReady, isModelReady, isRunning, startDetection, stopDetection]);

  // ── Load model once ─────────────────────────────────────────────────────
  useEffect(() => {
    loadModel();
    return () => {
      stopDetection();
    };
  }, [loadModel, stopDetection]);

  return {
    landmarks,
    isLoading,
    isRunning,
    isModelReady,
    loadError,
    onFrameRef,
    startDetection,
    stopDetection,
  };
}
