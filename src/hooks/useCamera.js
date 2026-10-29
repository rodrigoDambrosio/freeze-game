/**
 * useCamera.js
 *
 * React hook to manage the video feed from multiple sources configured in #admin:
 *  1. 'webcam' — Local USB / integrated camera via getUserMedia (optional deviceId)
 *  2. 'http'   — HTTP camera (MJPEG stream like IP Webcam / DroidCam / ESP32-CAM,
 *                JPEG snapshot endpoint, or HTTP video stream/file)
 *  3. 'file'   — Local video file (.mp4, .webm, .mov) uploaded in #admin and
 *                shared across tabs via IndexedDB (videoStorage.js)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { loadVideoFile } from '../lib/videoStorage.js';

function buildEffectiveHttpUrl(rawUrl, useProxy) {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (
    useProxy &&
    (trimmed.startsWith('http://') || trimmed.startsWith('https://')) &&
    !trimmed.startsWith(window.location.origin)
  ) {
    return `/__camera_proxy?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}

function detectStreamKind(url, mode) {
  if (mode && mode !== 'auto') return mode;
  const lower = (url || '').toLowerCase();
  if (/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|$)/i.test(lower)) {
    return 'video';
  }
  if (/(\/shot\.jpg|\.(jpg|jpeg))(\?|$)/i.test(lower)) {
    return 'snapshot';
  }
  if (/(\/video|\/mjpeg|\/mjpg|\/stream|\.mjpg|\.mjpeg|:81\/|:8080\/|:4747\/)/i.test(lower)) {
    return 'mjpeg';
  }
  // Try HTML5 video first; if the browser cannot decode it (e.g. multipart MJPEG),
  // CameraView / useCamera automatically falls back to the MJPEG <img> pipeline.
  return 'video-with-mjpeg-fallback';
}

export function useCamera(sourceConfig = {}) {
  const {
    videoSourceType = 'webcam',
    videoDeviceId = '',
    videoSourceUrl = '',
    httpStreamMode = 'auto',
    useCameraProxy = true,
    videoFileUpdatedAt = 0,
    videoLoop = true,
  } = sourceConfig;

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const objectUrlRef = useRef(null);
  const mjpegCleanupRef = useRef(null);
  const activeSessionRef = useRef(false);

  const [stream, setStream] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [sourceLabel, setSourceLabel] = useState('');

  const cleanupMedia = useCallback(() => {
    if (mjpegCleanupRef.current) {
      mjpegCleanupRef.current();
      mjpegCleanupRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
      videoRef.current.load?.();
    }
    setStream(null);
    setVideoSrc(null);
    setIsReady(false);
  }, []);

  /**
   * Starts an offscreen <img> -> <canvas> -> captureStream(30) pipeline for
   * MJPEG cameras (multipart/x-mixed-replace) or JPEG snapshot polling cameras.
   */
  const startMjpegPipeline = useCallback((rawUrl, useProxy, isSnapshot = false) => {
    return new Promise((resolve, reject) => {
      const effectiveUrl = buildEffectiveHttpUrl(rawUrl, useProxy);
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d');

      let rafId = null;
      let snapshotTimer = null;
      let settled = false;
      let stopped = false;

      const stopPipeline = () => {
        stopped = true;
        if (rafId) cancelAnimationFrame(rafId);
        if (snapshotTimer) clearTimeout(snapshotTimer);
        img.onload = null;
        img.onerror = null;
        img.src = '';
      };

      const startPump = () => {
        const pump = () => {
          if (stopped) return;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
            }
            try {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            } catch {
              // Ignore transient draw errors
            }
          }
          rafId = requestAnimationFrame(pump);
        };
        rafId = requestAnimationFrame(pump);
      };

      const loadNextSnapshot = () => {
        if (stopped) return;
        const sep = effectiveUrl.includes('?') ? '&' : '?';
        img.src = `${effectiveUrl}${sep}_t=${Date.now()}`;
      };

      img.onload = () => {
        if (stopped) return;
        if (!settled) {
          settled = true;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          startPump();
          const capturedStream = canvas.captureStream
            ? canvas.captureStream(30)
            : canvas.mozCaptureStream?.(30);
          if (!capturedStream) {
            stopPipeline();
            reject(new Error('El navegador no soporta captureStream para cámaras MJPEG.'));
            return;
          }
          mjpegCleanupRef.current = stopPipeline;
          resolve(capturedStream);
        }
        if (isSnapshot && !stopped) {
          snapshotTimer = setTimeout(loadNextSnapshot, 40);
        }
      };

      img.onerror = () => {
        if (stopped) return;
        if (!settled) {
          settled = true;
          stopPipeline();
          reject(
            new Error(
              'No se pudo conectar al stream HTTP/MJPEG. Verificá la URL y que la cámara esté en la misma red.'
            )
          );
        } else if (isSnapshot) {
          snapshotTimer = setTimeout(loadNextSnapshot, 300);
        }
      };

      if (isSnapshot) {
        loadNextSnapshot();
      } else {
        img.src = effectiveUrl;
      }
    });
  }, []);

  const startCamera = useCallback(async () => {
    cleanupMedia();
    activeSessionRef.current = true;
    setIsStarting(true);
    setError(null);

    try {
      // ── 1. Local video file from IndexedDB ──────────────────────────────
      if (videoSourceType === 'file') {
        const record = await loadVideoFile();
        if (!record || !record.blob) {
          throw new Error(
            'No hay ningún archivo de video seleccionado. Cargá un video desde el panel de Admin (#admin).'
          );
        }
        const objUrl = URL.createObjectURL(record.blob);
        objectUrlRef.current = objUrl;
        setSourceLabel(`Video: ${record.name}`);
        setVideoSrc(objUrl);
        return objUrl;
      }

      // ── 2. HTTP Camera or HTTP Video URL ────────────────────────────────
      if (videoSourceType === 'http') {
        if (!videoSourceUrl || !videoSourceUrl.trim()) {
          throw new Error(
            'No se configuró ninguna URL. Ingresá la URL de la cámara HTTP o video en el panel de Admin (#admin).'
          );
        }
        const kind = detectStreamKind(videoSourceUrl, httpStreamMode);
        setSourceLabel(`HTTP: ${videoSourceUrl}`);

        if (kind === 'mjpeg' || kind === 'snapshot') {
          const mediaStream = await startMjpegPipeline(
            videoSourceUrl,
            useCameraProxy,
            kind === 'snapshot'
          );
          streamRef.current = mediaStream;
          setStream(mediaStream);
          return mediaStream;
        }

        // 'video' or 'video-with-mjpeg-fallback'
        const effectiveUrl = buildEffectiveHttpUrl(videoSourceUrl, useCameraProxy);
        setVideoSrc(effectiveUrl);
        return effectiveUrl;
      }

      // ── 3. Local Webcam (getUserMedia) ──────────────────────────────────
      const videoConstraints = {
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 },
        frameRate: { ideal: 30 },
      };
      if (videoDeviceId) {
        videoConstraints.deviceId = { exact: videoDeviceId };
      } else {
        videoConstraints.facingMode = 'user';
      }

      let mediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (firstErr) {
        // If the saved deviceId is no longer plugged in, fall back to default webcam
        if (videoDeviceId && (firstErr.name === 'OverconstrainedError' || firstErr.name === 'NotFoundError')) {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 480 },
              facingMode: 'user',
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
        } else {
          throw firstErr;
        }
      }

      const trackLabel = mediaStream.getVideoTracks()[0]?.label;
      setSourceLabel(trackLabel ? `Cámara: ${trackLabel}` : 'Webcam local');
      streamRef.current = mediaStream;
      setStream(mediaStream);
      return mediaStream;
    } catch (err) {
      let message = err?.message || 'No se pudo acceder a la fuente de video.';
      if (err?.name === 'NotAllowedError') {
        message = 'Permiso de cámara denegado. Habilitá el acceso en tu navegador.';
      } else if (err?.name === 'NotFoundError') {
        message = 'No se encontró ninguna cámara en este dispositivo.';
      } else if (err?.name === 'NotReadableError') {
        message = 'La cámara está siendo usada por otra aplicación.';
      }
      setError(message);
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [
    cleanupMedia,
    videoSourceType,
    videoDeviceId,
    videoSourceUrl,
    httpStreamMode,
    useCameraProxy,
    startMjpegPipeline,
  ]);

  /**
   * Called by CameraView when an HTTP <video src="..."> fails to decode
   * (for example because the URL is actually an MJPEG camera stream).
   * In 'auto' mode we transparently switch to the MJPEG <img> pipeline.
   */
  const handleVideoError = useCallback(async () => {
    if (videoSourceType === 'http' && httpStreamMode === 'auto' && videoSrc) {
      setIsStarting(true);
      setError(null);
      setVideoSrc(null);
      try {
        const mediaStream = await startMjpegPipeline(videoSourceUrl, useCameraProxy, false);
        streamRef.current = mediaStream;
        setStream(mediaStream);
      } catch (err) {
        setError(
          err?.message ||
            'No se pudo reproducir la URL como video ni como stream MJPEG. Revisá la dirección en el panel de Admin.'
        );
      } finally {
        setIsStarting(false);
      }
      return;
    }
    setError('Error al reproducir la fuente de video. Verificá el formato o la URL en el panel de Admin.');
  }, [videoSourceType, httpStreamMode, videoSrc, videoSourceUrl, useCameraProxy, startMjpegPipeline]);

  const stopCamera = useCallback(() => {
    activeSessionRef.current = false;
    cleanupMedia();
  }, [cleanupMedia]);

  const handleVideoReady = useCallback(() => {
    setIsReady(true);
    setError(null);
  }, []);

  // Automatically hot-swap source if the admin changes camera/video settings while active
  const prevConfigKeyRef = useRef('');
  useEffect(() => {
    const configKey = JSON.stringify({
      videoSourceType,
      videoDeviceId,
      videoSourceUrl,
      httpStreamMode,
      useCameraProxy,
      videoFileUpdatedAt,
    });
    if (prevConfigKeyRef.current && prevConfigKeyRef.current !== configKey && activeSessionRef.current) {
      startCamera();
    }
    prevConfigKeyRef.current = configKey;
  }, [
    videoSourceType,
    videoDeviceId,
    videoSourceUrl,
    httpStreamMode,
    useCameraProxy,
    videoFileUpdatedAt,
    startCamera,
  ]);

  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  return {
    videoRef,
    stream,
    videoSrc,
    videoLoop,
    sourceLabel,
    isReady,
    isStarting,
    error,
    startCamera,
    stopCamera,
    handleVideoReady,
    handleVideoError,
  };
}
