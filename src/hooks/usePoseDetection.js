/**
 * usePoseDetection.js
 *
 * React hook wrapping MediaPipe Tasks-Vision PoseLandmarker.
 * Runs inference on each video frame via requestAnimationFrame.
 * Supports selectable GPU (High-Performance discrete GPU / Low-Power iGPU) or CPU,
 * selectable Pose model variants (lite / full / heavy) with offline fallback,
 * dynamic confidence tuning, and occlusion-resilient landmark smoothing.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { PoseLandmarker } from '@mediapipe/tasks-vision';
// Wasm runtime served from node_modules so it always matches the installed package version
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import {
  MEDIAPIPE_MODEL_URL,
  MIN_POSE_CONFIDENCE,
  POSE_MODEL_VARIANTS,
  DEFAULT_INFERENCE_DELEGATE,
  DEFAULT_POSE_MODEL_VARIANT,
} from '../lib/constants.js';
import { PoseSmoother } from '../lib/poseAnalyzer.js';
import { setGpuPowerPreference, getGpuHardwareInfo, createInferenceCanvas } from '../lib/gpuConfig.js';

export function usePoseDetection(
  videoRef,
  canvasRef,
  isVideoReady,
  minPoseConfidence = MIN_POSE_CONFIDENCE,
  inferenceDelegate = DEFAULT_INFERENCE_DELEGATE,
  poseModelVariant = DEFAULT_POSE_MODEL_VARIANT,
) {
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const lastTimestampRef = useRef(0);
  const smootherRef = useRef(new PoseSmoother());
  const minConfidenceRef = useRef(minPoseConfidence);
  const fpsWindowRef = useRef([]);
  const lastPerfReportAtRef = useRef(0);

  const [landmarks, setLandmarks] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isModelReady, setIsModelReady] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // Live hardware & performance telemetry
  const [activeDelegate, setActiveDelegate] = useState('GPU');
  const [activeModelVariant, setActiveModelVariant] = useState(poseModelVariant);
  const [gpuRenderer, setGpuRenderer] = useState(() => getGpuHardwareInfo().renderer);
  const [inferenceFps, setInferenceFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);

  // Draw/frame callback ref (so game logic can inject custom processing)
  const onFrameRef = useRef(null);

  // Dynamically update MediaPipe Pose confidence thresholds when changed from #admin
  useEffect(() => {
    minConfidenceRef.current = minPoseConfidence;
    if (!landmarkerRef.current) return;
    try {
      landmarkerRef.current.setOptions({
        minPoseDetectionConfidence: minPoseConfidence,
        minPosePresenceConfidence: minPoseConfidence,
        minTrackingConfidence: minPoseConfidence,
      });
    } catch {
      // Ignore if landmarker is mid-inference
    }
  }, [minPoseConfidence]);

  const stopDetection = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    smootherRef.current.reset();
    fpsWindowRef.current = [];
    setIsRunning(false);
    setLandmarks(null);
  }, []);

  // ── Load (or reload) MediaPipe model when delegate or model variant changes ─
  const loadModel = useCallback(async () => {
    stopDetection();
    if (landmarkerRef.current) {
      try {
        landmarkerRef.current.close?.();
      } catch {
        // Ignore close error
      }
      landmarkerRef.current = null;
    }

    setIsModelReady(false);
    setIsLoading(true);
    setLoadError(null);

    const conf = minConfidenceRef.current;
    const wantsCpu = inferenceDelegate === 'CPU';
    const powerPref = inferenceDelegate === 'GPU_LOW_POWER' ? 'low-power' : 'high-performance';
    setGpuPowerPreference(powerPref);

    const targetVariant = POSE_MODEL_VARIANTS[poseModelVariant] ? poseModelVariant : 'lite';
    const targetModelUrl = POSE_MODEL_VARIANTS[targetVariant].url;

    const createWithUrlAndDelegate = async (vision, modelAssetPath, delegate) => {
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
          delegate,
        },
        canvas: delegate === 'GPU' ? createInferenceCanvas(powerPref) : undefined,
        runningMode: 'VIDEO',
        numPoses: 1, // single-person (most prominent)
        minPoseDetectionConfidence: conf,
        minPosePresenceConfidence: conf,
        minTrackingConfidence: conf,
      });
    };

    try {
      const vision = { wasmLoaderPath, wasmBinaryPath };
      let resolvedVariant = targetVariant;
      let resolvedUrl = targetModelUrl;

      const tryCreateWithFallbackDelegate = async (modelUrl) => {
        if (wantsCpu) {
          const lm = await createWithUrlAndDelegate(vision, modelUrl, 'CPU');
          return { lm, delegateUsed: 'CPU' };
        }
        try {
          const lm = await createWithUrlAndDelegate(vision, modelUrl, 'GPU');
          return { lm, delegateUsed: 'GPU' };
        } catch (gpuErr) {
          console.warn('GPU delegate failed for MediaPipe, falling back to CPU:', gpuErr);
          const lm = await createWithUrlAndDelegate(vision, modelUrl, 'CPU');
          return { lm, delegateUsed: 'CPU (fallback)' };
        }
      };

      let created;
      try {
        created = await tryCreateWithFallbackDelegate(resolvedUrl);
      } catch (modelErr) {
        if (resolvedVariant !== 'lite') {
          console.warn(
            `No se pudo cargar el modelo "${resolvedVariant}" (${resolvedUrl}), usando "lite" local:`,
            modelErr
          );
          resolvedVariant = 'lite';
          resolvedUrl = MEDIAPIPE_MODEL_URL;
          created = await tryCreateWithFallbackDelegate(resolvedUrl);
        } else {
          throw modelErr;
        }
      }

      landmarkerRef.current = created.lm;
      setActiveDelegate(
        created.delegateUsed === 'GPU'
          ? (powerPref === 'high-performance' ? 'GPU (Alto rendimiento)' : 'GPU (Integrada)')
          : created.delegateUsed
      );
      setActiveModelVariant(resolvedVariant);
      setGpuRenderer(getGpuHardwareInfo().renderer);
      setIsModelReady(true);
    } catch (err) {
      console.error('MediaPipe load error:', err);
      setLoadError('No se pudo cargar el modelo de detección.');
    } finally {
      setIsLoading(false);
    }
  }, [inferenceDelegate, poseModelVariant, stopDetection]);

  // ── Inference loop ──────────────────────────────────────────────────────
  const startDetection = useCallback(() => {
    if (!landmarkerRef.current || !videoRef.current || !isVideoReady) return;
    setIsRunning(true);
    smootherRef.current.reset();
    fpsWindowRef.current = [];

    const loop = () => {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;

      // MediaStream videos commonly keep currentTime at zero. Gate by wall
      // clock instead, otherwise inference silently stops after the first frame.
      const now = performance.now();
      if (video.readyState >= 2 && video.videoWidth > 0 && now - lastTimestampRef.current >= 33) {
        lastTimestampRef.current = now;
        try {
          const t0 = performance.now();
          const result = landmarker.detectForVideo(video, now);
          const inferDuration = performance.now() - t0;

          const rawLms = result.landmarks?.[0] ?? null; // first (most prominent) person
          const lms = rawLms
            ? smootherRef.current.update(rawLms, now)
            : (smootherRef.current.reset(), null);

          setLandmarks(lms);

          // Track FPS and inference latency (throttled state update every ~500ms)
          const samples = fpsWindowRef.current;
          samples.push({ t: now, ms: inferDuration });
          while (samples.length > 0 && now - samples[0].t > 1000) {
            samples.shift();
          }
          if (now - lastPerfReportAtRef.current >= 500 && samples.length >= 2) {
            lastPerfReportAtRef.current = now;
            const spanSec = Math.max(0.05, (samples[samples.length - 1].t - samples[0].t) / 1000);
            const fps = Math.round(((samples.length - 1) / spanSec));
            const avgMs = +(samples.reduce((acc, s) => acc + s.ms, 0) / samples.length).toFixed(1);
            setInferenceFps(fps);
            setInferenceMs(avgMs);
          }

          if (onFrameRef.current) {
            onFrameRef.current(lms, video, rawLms);
          }
        } catch {
          // Suppress frame inference errors
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [videoRef, isVideoReady]);

  // ── Auto-start when video and model are ready ───────────────────────────
  useEffect(() => {
    if (isVideoReady && isModelReady && !isRunning) {
      startDetection();
    } else if (!isVideoReady && isRunning) {
      stopDetection();
    }
  }, [isVideoReady, isModelReady, isRunning, startDetection, stopDetection]);

  // ── Load model on mount and whenever delegate/variant changes ───────────
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
    activeDelegate,
    activeModelVariant,
    gpuRenderer,
    inferenceFps,
    inferenceMs,
    onFrameRef,
    startDetection,
    stopDetection,
  };
}
