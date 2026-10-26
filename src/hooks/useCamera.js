/**
 * useCamera.js
 * React hook to access the device camera (getUserMedia).
 * Handles permissions, stream state, video attachment and cleanup.
 */
import { useState, useEffect, useRef, useCallback } from 'react';

export function useCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [stream, setStream] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    setIsStarting(true);
    setError(null);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
        },
        audio: false,
      });

      streamRef.current = mediaStream;
      setStream(mediaStream);

      // If video element is already mounted, attach immediately
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        try {
          await videoRef.current.play();
          setIsReady(true);
        } catch (playErr) {
          console.warn('Initial video play error:', playErr);
        }
      }

      return mediaStream;
    } catch (err) {
      let message = 'No se pudo acceder a la cámara.';
      if (err.name === 'NotAllowedError') {
        message = 'Permiso de cámara denegado. Habilitá el acceso en tu navegador.';
      } else if (err.name === 'NotFoundError') {
        message = 'No se encontró ninguna cámara en este dispositivo.';
      } else if (err.name === 'NotReadableError') {
        message = 'La cámara está siendo usada por otra aplicación.';
      }
      setError(message);
      return null;
    } finally {
      setIsStarting(false);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStream(null);
    setIsReady(false);
  }, []);

  const handleVideoReady = useCallback(() => {
    setIsReady(true);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    stream,
    isReady,
    isStarting,
    error,
    startCamera,
    stopCamera,
    handleVideoReady,
  };
}
