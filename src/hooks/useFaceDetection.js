/**
 * useFaceDetection.js
 *
 * React hook wrapping MediaPipe Tasks-Vision FaceLandmarker.
 *
 * Runs alongside the pose landmarker rather than replacing it: pose reports
 * only five coarse face points (nose, eyes, ears) and cannot resolve an
 * eyelid or a jaw. The face mesh returns 478 points plus 52 blendshape
 * scores — the expression channel the vitality monitor is built on.
 *
 * Loaded on demand, because the model is 3.7 MB and the Freeze Challenge
 * does not need it.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { MEDIAPIPE_FACE_MODEL_URL, MIN_POSE_CONFIDENCE } from '../lib/constants.js';

export function useFaceDetection(videoRef, isVideoReady, enabled) {
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimestampRef = useRef(0);
  const onFrameRef = useRef(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const loadModel = useCallback(async () => {
    if (landmarkerRef.current) {
      setIsModelReady(true);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const vision = { wasmLoaderPath, wasmBinaryPath };
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: MEDIAPIPE_FACE_MODEL_URL, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        // The blendshapes are the point of loading this model at all.
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: MIN_POSE_CONFIDENCE,
        minFacePresenceConfidence: MIN_POSE_CONFIDENCE,
        minTrackingConfidence: MIN_POSE_CONFIDENCE,
      });

      try {
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, options('GPU'));
      } catch (gpuErr) {
        console.warn('GPU delegate failed for FaceLandmarker, falling back to CPU:', gpuErr);
        landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, options('CPU'));
      }

      setIsModelReady(true);
    } catch (err) {
      console.error('FaceLandmarker load error:', err);
      setLoadError('No se pudo cargar el modelo facial.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startDetection = useCallback(() => {
    if (!landmarkerRef.current || !videoRef.current || !isVideoReady) return;
    setIsRunning(true);

    const loop = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;

      // MediaStream videos commonly keep currentTime at zero. Gate by wall
      // clock instead, otherwise inference silently stops after the first frame.
      const now = performance.now();
      if (video.readyState >= 2 && now - lastTimestampRef.current >= 33) {
        lastTimestampRef.current = now;
        try {
          const result = landmarker.detectForVideo(video, now);
          const landmarks = result.faceLandmarks?.[0] ?? null;
          const blendshapes = result.faceBlendshapes?.[0]?.categories ?? null;
          onFrameRef.current?.({ landmarks, blendshapes, now });
        } catch {
          // Suppress per-frame inference errors
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
  }, []);

  // Load only once the monitor actually asks for it.
  useEffect(() => {
    if (enabled) loadModel();
  }, [enabled, loadModel]);

  useEffect(() => {
    if (enabled && isVideoReady && isModelReady && !isRunning) {
      startDetection();
    } else if ((!enabled || !isVideoReady) && isRunning) {
      stopDetection();
    }
  }, [enabled, isVideoReady, isModelReady, isRunning, startDetection, stopDetection]);

  useEffect(() => stopDetection, [stopDetection]);

  return { isLoading, isModelReady, isRunning, loadError, onFrameRef };
}
