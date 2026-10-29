import React, { useEffect, useState, useCallback } from 'react';
import {
  SENSITIVITY_LEVELS,
  MIN_FREEZE_SECONDS,
  MAX_FREEZE_SECONDS,
  SIMON_PRESETS,
  MIN_REWARD_THRESHOLD,
  MAX_REWARD_THRESHOLD,
  POSE_MODEL_VARIANTS,
} from '../lib/constants.js';
import { GAME_STATE } from '../hooks/useGameLogic.js';
import { SIMON_STATE } from '../hooks/useSimonSaysLogic.js';
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  readTelemetry,
  subscribeTelemetry,
  TELEMETRY_STALE_MS,
} from '../lib/adminSync.js';
import { saveVideoFile, clearVideoFile } from '../lib/videoStorage.js';
import {
  getGpuHardwareInfo,
  probeAllGpus,
  isLikelyIntegratedGpu,
  isSoftwareRenderer,
  setGpuPowerPreference,
} from '../lib/gpuConfig.js';
import { clearLeaderboard } from '../lib/leaderboard.js';
import { SIMON_COMMAND_POOL, DEFAULT_DISABLED_COMMANDS } from '../lib/simonCommands.js';
import {
  AMBIENT_POSE_SIGNALS,
  AMBIENT_FACE_SIGNALS,
  AMBIENT_SIGNALS,
  DEFAULT_DISABLED_AMBIENT_SIGNALS,
} from '../lib/ambientSignals.js';
import '../App.css';
import './AdminScreen.css';

const GAME_MODE_OPTIONS = [
  { value: 'freeze', label: 'Quedate quieto', description: 'Suprimir toda señal de vida durante la ronda.' },
  { value: 'simon', label: 'Simón dice', description: 'Cumplir una secuencia de posturas por puntos.' },
];

const DELEGATE_OPTIONS = [
  {
    value: 'GPU',
    label: 'GPU · Alto rendimiento (Recomendado)',
    description: 'Usa aceleración WebGL2 y solicita la placa de video dedicada (NVIDIA / AMD).',
  },
  {
    value: 'GPU_LOW_POWER',
    label: 'GPU · Ahorro / Integrada',
    description: 'Usa aceleración por GPU priorizando la placa integrada de menor consumo.',
  },
  {
    value: 'CPU',
    label: 'CPU · WebAssembly',
    description: 'Ejecuta los modelos en el procesador sin usar WebGL.',
  },
];

const VIDEO_SOURCE_OPTIONS = [
  { value: 'webcam', label: 'Webcam local', description: 'Cámara USB o integrada del equipo' },
  { value: 'http', label: 'Cámara HTTP / URL', description: 'Stream MJPEG (IP Webcam, DroidCam, ESP32) o video HTTP' },
  { value: 'file', label: 'Archivo de video', description: 'Usar un video local (.mp4, .webm, .mov) para jugar' },
];

const HTTP_STREAM_MODE_OPTIONS = [
  { value: 'auto', label: 'Automático (detectar video o MJPEG)' },
  { value: 'mjpeg', label: 'Stream MJPEG (IP Webcam / DroidCam / ESP32)' },
  { value: 'video', label: 'Video directo HTTP (.mp4 / .webm)' },
  { value: 'snapshot', label: 'Capturas continuas JPG (/shot.jpg)' },
];

const SIMON_STATE_LABELS = {
  [SIMON_STATE.IDLE]: 'En portada',
  [SIMON_STATE.DETECTING]: 'Buscando jugador',
  [SIMON_STATE.READY]: 'Listo para jugar',
  [SIMON_STATE.PLAYING]: 'Jugando',
  [SIMON_STATE.FINISHED]: 'Terminó',
};

const BLINK_OPTIONS = [
  { value: 0, label: 'Ninguno' },
  { value: 1, label: '1' },
  { value: 3, label: '3' },
  { value: 5, label: '5' },
];

// How far past the current threshold the live meter's scale extends —
// keeps the bar readable instead of pinning at 100% the instant it breaches.
const METER_HEADROOM = 1.8;

const STATE_LABELS = {
  [GAME_STATE.IDLE]: 'En portada',
  [GAME_STATE.DETECTING]: 'Buscando jugador',
  [GAME_STATE.READY]: 'Listo para jugar',
  [GAME_STATE.PLAYING]: 'Jugando',
  [GAME_STATE.WON]: 'Ganó',
  [GAME_STATE.LOST]: 'Detectado',
};

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * AdminScreen
 * Standalone config page (index.html#admin), opened in its own tab/window so
 * participants never see settings being adjusted. Talks to the game tab only
 * through adminSync (localStorage + `storage` events) and IndexedDB for video
 * files; changes apply live.
 */
export default function AdminScreen() {
  const [settings, setSettings] = useState(readSettings);
  const [telemetry, setTelemetry] = useState(readTelemetry);
  const [now, setNow] = useState(() => Date.now());
  const [theme, setTheme] = useState(() => localStorage.getItem('cuida-theme') || 'dark');
  const [localGpuInfo, setLocalGpuInfo] = useState(() => getGpuHardwareInfo(true));
  const [showNvidiaGuide, setShowNvidiaGuide] = useState(false);

  // Local draft for HTTP URL input so typing doesn't reconnect on every keystroke
  const [urlDraft, setUrlDraft] = useState(() => settings.videoSourceUrl || '');
  const [devices, setDevices] = useState([]);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Written immediately — the game tab picks changes up live via `storage`.
  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      writeSettings(next);
      return next;
    });
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'videoinput'));
    } catch {
      // Ignore enumeration errors
    }
  }, []);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    const pref = settings.inferenceDelegate === 'GPU_LOW_POWER' ? 'low-power' : 'high-performance';
    setGpuPowerPreference(pref);
    setLocalGpuInfo(getGpuHardwareInfo(true));
    probeAllGpus().then((info) => {
      if (info) setLocalGpuInfo(info);
    });
  }, [settings.inferenceDelegate]);

  useEffect(() => subscribeTelemetry(setTelemetry), []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'cuida-theme' && e.newValue) setTheme(e.newValue);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Telemetry only updates on a `storage` event; tick locally so a game tab
  // that was closed is reflected as "sin conexión" too.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const {
    freezeSeconds,
    sensitivity,
    detectGestures,
    detectBlink,
    blinkBudget,
    gameMode,
    simonPreset,
    simonStickerThreshold,
    simonPenThreshold,
    // GPU / CPU & Pose Model
    inferenceDelegate,
    poseModelVariant,
    // Video / Camera source
    videoSourceType,
    videoDeviceId,
    videoSourceUrl,
    httpStreamMode,
    useCameraProxy,
    videoFileName,
    videoFileSize,
    videoLoop,
    mirrorVideo,
    // Smoothing & Occlusion
    poseSmoothing,
    occlusionDamping,
    occlusionHoldMs,
    minLandmarkVisibility,
    minPoseConfidence,
    hideNoisyExtremities,
    // Fine-tuning (Freeze)
    customDynamicThreshold,
    customAnchorThreshold,
    customGestureThreshold,
    breachConfirmFrames,
    poseLossGraceMs,
    zoneWeightHead,
    zoneWeightTorso,
    zoneWeightArms,
    zoneWeightLegs,
    // Fine-tuning (Simon)
    simonCommandCount,
    simonCommandSeconds,
    simonConfirmFrames,
    simonArmsUpMargin,
    simonArmsDownMargin,
    simonTouchMargin,
    disabledCommands = DEFAULT_DISABLED_COMMANDS,
    showAmbientTag = true,
    showAmbientMotion = true,
    disabledAmbientSignals = DEFAULT_DISABLED_AMBIENT_SIGNALS,
  } = settings;

  const disabledSet = new Set(disabledCommands);
  const enabledCommandsCount = SIMON_COMMAND_POOL.filter((c) => !disabledSet.has(c.id)).length;

  const disabledAmbientSet = new Set(disabledAmbientSignals);
  const enabledAmbientCount = AMBIENT_SIGNALS.filter((s) => !disabledAmbientSet.has(s.id)).length;

  const handleToggleCommand = (cmdId) => {
    const nextSet = new Set(disabledCommands);
    if (nextSet.has(cmdId)) {
      nextSet.delete(cmdId);
    } else {
      // Keep at least 1 command enabled so Simon Says always has a valid pool
      if (enabledCommandsCount <= 1) return;
      nextSet.add(cmdId);
    }
    update({ disabledCommands: Array.from(nextSet) });
  };

  const handleToggleAmbientSignal = (sigId) => {
    const nextSet = new Set(disabledAmbientSignals);
    if (nextSet.has(sigId)) {
      nextSet.delete(sigId);
    } else {
      nextSet.add(sigId);
    }
    update({ disabledAmbientSignals: Array.from(nextSet) });
  };

  const isSimon = gameMode === 'simon';

  const isConnected = !!telemetry && now - telemetry.ts < TELEMETRY_STALE_MS;
  const movementScore = isConnected ? telemetry.movementScore ?? 0 : 0;
  const hasLiveReading = isConnected && telemetry.hasLiveReading;
  const gameState = isConnected ? telemetry.gameState : null;

  const activeThreshold = customDynamicThreshold ?? SENSITIVITY_LEVELS[sensitivity].threshold;
  const meterPercent = Math.min(100, (movementScore / (activeThreshold * METER_HEADROOM)) * 100);
  const isOverThreshold = movementScore > activeThreshold;

  const connectionLabel = isConnected
    ? (isSimon ? SIMON_STATE_LABELS[gameState] : STATE_LABELS[gameState]) || 'Conectado'
    : 'Sin pantalla de juego';

  const reportedGpuName = (isConnected && telemetry?.gpuRenderer) || localGpuInfo.renderer;
  const isUsingSoftwareGpu = isSoftwareRenderer(reportedGpuName);
  const isUsingIntegratedOnHighPerf =
    inferenceDelegate === 'GPU' && isLikelyIntegratedGpu(reportedGpuName);
  const reportedDelegate = (isConnected && telemetry?.activeDelegate) || (
    inferenceDelegate === 'CPU' ? 'CPU' : 'GPU'
  );
  const reportedModel = (isConnected && telemetry?.activeModelVariant) || poseModelVariant;
  const reportedFps = isConnected ? telemetry?.inferenceFps ?? 0 : 0;
  const reportedMs = isConnected ? telemetry?.inferenceMs ?? 0 : 0;

  const handleSelectSensitivityPreset = (key) => {
    const preset = SENSITIVITY_LEVELS[key];
    update({
      sensitivity: key,
      customDynamicThreshold: preset.threshold,
      customAnchorThreshold: preset.anchorThreshold,
      customGestureThreshold: preset.gestureThreshold,
    });
  };

  const handleSelectSimonPreset = (key) => {
    const preset = SIMON_PRESETS[key];
    update({
      simonPreset: key,
      simonCommandCount: preset.commandCount,
      simonCommandSeconds: preset.commandSeconds,
    });
  };

  const handleApplyHttpUrl = (e) => {
    e?.preventDefault();
    update({
      videoSourceType: 'http',
      videoSourceUrl: urlDraft.trim(),
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const saved = await saveVideoFile(file);
      update({
        videoSourceType: 'file',
        videoFileName: saved.name,
        videoFileSize: saved.size,
        videoFileUpdatedAt: saved.updatedAt,
      });
    } catch (err) {
      setFileError(err?.message || 'No se pudo guardar el archivo de video.');
    } finally {
      setFileLoading(false);
    }
  };

  const handleResetDefaults = () => {
    if (!window.confirm('¿Restaurar todos los parámetros de detección, GPU y suavizado a sus valores por defecto?')) {
      return;
    }
    setUrlDraft(DEFAULT_SETTINGS.videoSourceUrl);
    clearVideoFile().catch(() => { });
    setSettings(DEFAULT_SETTINGS);
    writeSettings(DEFAULT_SETTINGS);
  };

  const handleClearLeaderboard = () => {
    if (!window.confirm(`¿Vaciar el leaderboard de "${isSimon ? 'Simón dice' : 'Quedate quieto'}"?`)) return;
    clearLeaderboard(gameMode);
  };

  return (
    <div className="app admin-page" data-theme={theme}>
      <div className="admin-screen glass animate-fadeInScale" id="admin-screen">
        {/* Header */}
        <div className="admin-header">
          <div>
            <h1 className="admin-title">Configuración · Expo</h1>
            <p className="admin-subtitle">Pantalla aparte — los cambios se aplican en vivo</p>
          </div>
          <div className={`admin-conn-badge ${isConnected ? 'connected' : ''}`}>
            <span className="state-dot" />
            {connectionLabel}
          </div>
        </div>

        <div className="admin-divider" />

        {/* ── 1. Aceleración por Hardware (GPU / CPU) y Modelo ── */}
        <section className="admin-section" id="admin-gpu-section">
          <label className="admin-label">
            Procesador de inferencia (GPU / CPU)
            <span className="admin-value-badge">
              {inferenceDelegate === 'CPU' ? 'CPU' : 'GPU'}
            </span>
          </label>

          <div className="admin-sensitivity-grid">
            {DELEGATE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                id={`delegate-${opt.value.toLowerCase()}`}
                className={`admin-sensitivity-btn ${inferenceDelegate === opt.value ? 'active' : ''}`}
                onClick={() => update({ inferenceDelegate: opt.value })}
              >
                <span className="sensitivity-name">{opt.label}</span>
                <span className="sensitivity-desc">{opt.description}</span>
              </button>
            ))}
          </div>

          <label className="admin-label" style={{ marginTop: 6 }}>
            Modelo MediaPipe Pose
            <span className="admin-value-badge">{poseModelVariant.toUpperCase()}</span>
          </label>
          <div className="admin-sensitivity-grid">
            {Object.entries(POSE_MODEL_VARIANTS).map(([key, m]) => (
              <button
                key={key}
                type="button"
                id={`pose-model-${key}`}
                className={`admin-sensitivity-btn ${poseModelVariant === key ? 'active' : ''}`}
                onClick={() => update({ poseModelVariant: key })}
              >
                <span className="sensitivity-name">{m.label}</span>
                <span className="sensitivity-desc">{m.description}</span>
              </button>
            ))}
          </div>

          {/* Live GPU & FPS status box */}
          <div className="admin-status-box">
            <div>
              ⚡ Activo: <strong>{reportedDelegate}</strong> · Modelo: <strong>{reportedModel.toUpperCase()}</strong>
              {reportedFps > 0 && (
                <> · <strong>{reportedFps} FPS</strong> ({reportedMs} ms/cuadro)</>
              )}
            </div>
            {reportedGpuName && (
              <div style={{ marginTop: 3, opacity: 0.92 }}>
                🖥️ Placa activa en navegador (WebGL): <strong>{reportedGpuName}</strong>
                {isUsingSoftwareGpu ? (
                  <span style={{ color: 'var(--danger, #ef4444)', marginLeft: 6, fontWeight: 600 }}>
                    (Emulación por software · Sin GPU física)
                  </span>
                ) : isUsingIntegratedOnHighPerf ? (
                  <span style={{ color: 'var(--warn, #f59e0b)', marginLeft: 6, fontWeight: 600 }}>
                    (Integrada · GPU 0)
                  </span>
                ) : null}
              </div>
            )}
            {localGpuInfo.webGpuHighPerfAdapterName &&
              localGpuInfo.webGpuHighPerfAdapterName !== reportedGpuName && (
                <div style={{ marginTop: 3, opacity: 0.88 }}>
                  🎯 Placa dedicada detectada en sistema: <strong>{localGpuInfo.webGpuHighPerfAdapterName}</strong>
                </div>
              )}

            {isUsingIntegratedOnHighPerf && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="admin-row-between">
                  <span style={{ color: isUsingSoftwareGpu ? 'var(--danger, #ef4444)' : 'var(--warn, #f59e0b)', fontWeight: 600 }}>
                    {isUsingSoftwareGpu
                      ? '🚨 El navegador cayó en Microsoft Basic Render Driver (emulación lenta por CPU)'
                      : `⚠️ Windows asignó el navegador a la integrada (${reportedGpuName}) en vez de tu NVIDIA (GPU 1)`}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost admin-mini-btn"
                    onClick={() => setShowNvidiaGuide((v) => !v)}
                  >
                    {showNvidiaGuide ? 'Ocultar pasos' : 'Cómo usar mi NVIDIA'}
                  </button>
                </div>
                {(showNvidiaGuide || isUsingSoftwareGpu) && (
                  <div style={{ marginTop: 6, lineHeight: 1.5, opacity: 0.95 }}>
                    {isUsingSoftwareGpu && (
                      <p style={{ margin: '0 0 6px 0', color: 'var(--warn, #f59e0b)' }}>
                        <strong>¡Ojo!</strong> Si cambiaste <code>#use-angle</code> en Chrome/Edge, ese backend no es compatible con tu driver y desactivó la placa física. <strong>Volvé a poner <code>chrome://flags/#use-angle</code> en <code>Default</code></strong> y usá el método de Windows de abajo:
                      </p>
                    )}
                    <ol style={{ margin: '4px 0 0 18px', padding: 0 }}>
                      <li>
                        Dejá <code>chrome://flags/#use-angle</code> en <strong><code>Default</code></strong>.
                      </li>
                      <li style={{ marginTop: 4 }}>
                        Abrí <strong>Configuración de Windows → Sistema → Pantalla → Gráficos</strong>.
                      </li>
                      <li style={{ marginTop: 4 }}>
                        Buscá tu navegador (<strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>), entrá en <strong>Opciones</strong> y elegí <strong>Alto rendimiento (GPU: NVIDIA)</strong>.
                      </li>
                      <li style={{ marginTop: 4 }}>
                        <strong>Importante:</strong> Cerrá <em>todas</em> las ventanas de Chrome/Edge (fijate en el Administrador de tareas que no quede ningún <code>chrome.exe</code> abierto en segundo plano) y volvelo a abrir.
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <div className="admin-divider" />

        {/* ── 2. Fuente de Video / Cámara ── */}
        <section className="admin-section" id="admin-video-source-section">
          <label className="admin-label">
            Fuente de cámara / video
            <span className="admin-value-badge">
              {videoSourceType === 'webcam' ? 'Webcam' : videoSourceType === 'http' ? 'HTTP' : 'Video'}
            </span>
          </label>

          <div className="admin-source-tabs">
            {VIDEO_SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                id={`video-source-${opt.value}`}
                className={`admin-sensitivity-btn ${videoSourceType === opt.value ? 'active' : ''}`}
                onClick={() => update({ videoSourceType: opt.value })}
              >
                <span className="sensitivity-name">{opt.label}</span>
                <span className="sensitivity-desc">{opt.description}</span>
              </button>
            ))}
          </div>

          {/* Webcam options */}
          {videoSourceType === 'webcam' && (
            <div className="admin-subbox">
              <div className="admin-row-between">
                <label className="admin-sublabel" htmlFor="webcam-device-select">
                  Dispositivo de cámara
                </label>
                <button
                  type="button"
                  className="btn btn-ghost admin-mini-btn"
                  onClick={refreshDevices}
                >
                  Actualizar lista
                </button>
              </div>
              <select
                id="webcam-device-select"
                className="admin-select"
                value={videoDeviceId}
                onChange={(e) => update({ videoDeviceId: e.target.value })}
              >
                <option value="">Cámara predeterminada del sistema</option>
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Cámara #${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* HTTP Camera / Stream URL options */}
          {videoSourceType === 'http' && (
            <form className="admin-subbox" onSubmit={handleApplyHttpUrl}>
              <label className="admin-sublabel" htmlFor="http-camera-url">
                URL de cámara HTTP o video
              </label>
              <div className="admin-input-row">
                <input
                  id="http-camera-url"
                  type="url"
                  className="admin-text-input"
                  placeholder="http://192.168.1.50:8080/video o http://.../video.mp4"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                />
                <button
                  type="submit"
                  id="apply-http-url-btn"
                  className="btn btn-primary admin-apply-btn"
                >
                  Conectar
                </button>
              </div>
              <p className="admin-hint">
                Ejemplos: <code>http://IP:8080/video</code> (IP Webcam), <code>http://IP:4747/video</code> (DroidCam), <code>http://IP:81/stream</code> (ESP32-CAM) o un enlace directo <code>.mp4</code> / <code>.webm</code>.
              </p>

              <label className="admin-sublabel" htmlFor="http-stream-mode" style={{ marginTop: 6 }}>
                Modo de protocolo HTTP
              </label>
              <select
                id="http-stream-mode"
                className="admin-select"
                value={httpStreamMode}
                onChange={(e) => update({ httpStreamMode: e.target.value })}
              >
                {HTTP_STREAM_MODE_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <label className="admin-toggle" style={{ paddingBottom: 0 }}>
                <input
                  type="checkbox"
                  id="use-camera-proxy"
                  checked={useCameraProxy}
                  onChange={(e) => update({ useCameraProxy: e.target.checked })}
                />
                <span className="admin-toggle-body">
                  <span className="admin-toggle-name">Usar proxy local (evita bloqueo CORS)</span>
                  <span className="admin-toggle-desc">
                    Enruta el stream por el servidor local para que MediaPipe pueda analizar cámaras IP sin cabeceras CORS.
                  </span>
                </span>
              </label>

              {videoSourceUrl && (
                <p className="admin-hint">
                  URL activa: <strong>{videoSourceUrl}</strong>
                </p>
              )}
            </form>
          )}

          {/* Local Video File options */}
          {videoSourceType === 'file' && (
            <div className="admin-subbox">
              <label className="admin-sublabel" htmlFor="video-file-input">
                Seleccionar archivo de video de tu computadora
              </label>
              <input
                id="video-file-input"
                type="file"
                accept="video/mp4,video/webm,video/ogg,video/quicktime,video/*"
                onChange={handleFileChange}
                className="admin-file-input"
              />
              {fileLoading && <p className="admin-hint">Cargando video para la pantalla de juego…</p>}
              {fileError && <p className="admin-hint admin-error-text">{fileError}</p>}
              {videoFileName ? (
                <p className="admin-hint">
                  Archivo listo: <strong>{videoFileName}</strong>{' '}
                  {videoFileSize ? `(${formatBytes(videoFileSize)})` : ''}
                </p>
              ) : (
                <p className="admin-hint">
                  Elegí un video (<code>.mp4</code>, <code>.webm</code>, <code>.mov</code>) para reproducirlo en la pantalla de juego y usar su imagen con los detectores.
                </p>
              )}
            </div>
          )}

          {/* Common image toggles */}
          <div className="admin-toggles-compact">
            <label className="admin-toggle">
              <input
                type="checkbox"
                id="mirror-video"
                checked={mirrorVideo}
                onChange={(e) => update({ mirrorVideo: e.target.checked })}
              />
              <span className="admin-toggle-body">
                <span className="admin-toggle-name">Espejar imagen (modo selfie)</span>
                <span className="admin-toggle-desc">
                  Desactivalo si usás una cámara externa frontal o un video grabado que no quieras invertido.
                </span>
              </span>
            </label>

            {videoSourceType !== 'webcam' && (
              <label className="admin-toggle">
                <input
                  type="checkbox"
                  id="video-loop"
                  checked={videoLoop}
                  onChange={(e) => update({ videoLoop: e.target.checked })}
                />
                <span className="admin-toggle-body">
                  <span className="admin-toggle-name">Repetir video en bucle</span>
                  <span className="admin-toggle-desc">
                    Reinicia automáticamente el video al llegar al final.
                  </span>
                </span>
              </label>
            )}
          </div>

          {/* Live camera/video status from game tab */}
          {isConnected && (telemetry?.sourceLabel || telemetry?.cameraError) && (
            <div className="admin-status-box">
              {telemetry.cameraError ? (
                <span className="admin-error-text">⚠️ {telemetry.cameraError}</span>
              ) : (
                <span>
                  📹 Activo en juego: <strong>{telemetry.sourceLabel}</strong>{' '}
                  ({telemetry.cameraReady ? 'transmitiendo' : 'esperando inicio'})
                </span>
              )}
            </div>
          )}
        </section>

        <div className="admin-divider" />

        {/* ── 3. Suavizado del Esqueleto y Oclusión ── */}
        <section className="admin-section" id="admin-smoothing-section">
          <label className="admin-label" htmlFor="pose-smoothing-slider">
            Suavizado del esqueleto
            <span className="admin-value-badge">{Math.round(poseSmoothing * 100)}%</span>
          </label>
          <div className="admin-slider-wrap">
            <span className="admin-range-hint">0%</span>
            <input
              id="pose-smoothing-slider"
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={poseSmoothing}
              onChange={(e) => update({ poseSmoothing: Number(e.target.value) })}
              className="admin-slider"
            />
            <span className="admin-range-hint">95%</span>
          </div>
          <p className="admin-hint">
            Filtra el temblor de los keypoints y suaviza el movimiento del esqueleto en pantalla. Recomendado para expo: <strong>65%–75%</strong>.
          </p>

          <label className="admin-label" htmlFor="min-vis-slider" style={{ marginTop: 8 }}>
            Visibilidad mínima de keypoints (oclusión)
            <span className="admin-value-badge">{Math.round(minLandmarkVisibility * 100)}%</span>
          </label>
          <div className="admin-slider-wrap">
            <span className="admin-range-hint">25%</span>
            <input
              id="min-vis-slider"
              type="range"
              min={0.25}
              max={0.90}
              step={0.05}
              value={minLandmarkVisibility}
              onChange={(e) => update({ minLandmarkVisibility: Number(e.target.value) })}
              className="admin-slider"
            />
            <span className="admin-range-hint">90%</span>
          </div>
          <p className="admin-hint">
            Descarta articulaciones tapadas o adivinadas por el modelo cuando hay oclusión (ej. piernas detrás de un mostrador o brazos cruzados).
          </p>

          <label className="admin-label" htmlFor="occlusion-hold-slider" style={{ marginTop: 8 }}>
            Retención ante oclusión breve
            <span className="admin-value-badge">{occlusionHoldMs} ms</span>
          </label>
          <div className="admin-slider-wrap">
            <span className="admin-range-hint">0ms</span>
            <input
              id="occlusion-hold-slider"
              type="range"
              min={0}
              max={1500}
              step={50}
              value={occlusionHoldMs}
              onChange={(e) => update({ occlusionHoldMs: Number(e.target.value) })}
              className="admin-slider"
            />
            <span className="admin-range-hint">1.5s</span>
          </div>

          <label className="admin-toggle">
            <input
              type="checkbox"
              id="occlusion-damping"
              checked={occlusionDamping}
              onChange={(e) => update({ occlusionDamping: e.target.checked })}
            />
            <span className="admin-toggle-body">
              <span className="admin-toggle-name">Amortiguar saltos por oclusión</span>
              <span className="admin-toggle-desc">
                Congela la última posición confiable cuando un punto se tapa y bloquea saltos bruscos de un cuadro a otro.
              </span>
            </span>
          </label>

          <label className="admin-toggle">
            <input
              type="checkbox"
              id="hide-noisy-extremities"
              checked={hideNoisyExtremities}
              onChange={(e) => update({ hideNoisyExtremities: e.target.checked })}
            />
            <span className="admin-toggle-body">
              <span className="admin-toggle-name">Simplificar manos y pies ruidosos</span>
              <span className="admin-toggle-desc">
                Oculta los sub-puntos de dedos/pies y exige mayor certeza en piernas para que el esqueleto se vea limpio.
              </span>
            </span>
          </label>
        </section>

        <div className="admin-divider" />

        {/* ── 4. Modo de juego ── */}
        <section className="admin-section">
          <label className="admin-label">Modo de juego</label>
          <div className="admin-sensitivity-grid">
            {GAME_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                id={`game-mode-${opt.value}`}
                className={`admin-sensitivity-btn ${gameMode === opt.value ? 'active' : ''}`}
                onClick={() => update({ gameMode: opt.value })}
              >
                <span className="sensitivity-name">{opt.label}</span>
                <span className="sensitivity-desc">{opt.description}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-ghost admin-clear-leaderboard-btn" onClick={handleClearLeaderboard}>
            Vaciar leaderboard de "{isSimon ? 'Simón dice' : 'Quedate quieto'}"
          </button>
        </section>

        <div className="admin-divider" />

        {/* ── Órdenes de Simón Dice ── */}
        <section className="admin-section" id="admin-commands-section">
          <div className="admin-row-between">
            <label className="admin-label" style={{ marginBottom: 0 }}>
              Órdenes de Simón dice
              <span className="admin-value-badge">
                {enabledCommandsCount}/{SIMON_COMMAND_POOL.length}
              </span>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-ghost admin-mini-btn"
                onClick={() => update({ disabledCommands: DEFAULT_DISABLED_COMMANDS })}
              >
                Recomendadas
              </button>
              <button
                type="button"
                className="btn btn-ghost admin-mini-btn"
                onClick={() => update({ disabledCommands: [] })}
              >
                Activar todas
              </button>
            </div>
          </div>
          <p className="admin-hint">
            Activá o desactivá qué órdenes puede pedir <strong>Simón dice</strong> durante una partida.
          </p>

          <label className="admin-sublabel" style={{ marginTop: 4 }}>
            Posturas corporales y manos
          </label>
          <div className="admin-sensitivity-grid">
            {SIMON_COMMAND_POOL.filter((c) => c.category === 'pose').map((cmd) => {
              const isEnabled = !disabledSet.has(cmd.id);
              return (
                <button
                  key={cmd.id}
                  type="button"
                  id={`toggle-cmd-${cmd.id}`}
                  className={`admin-sensitivity-btn ${isEnabled ? 'active' : ''}`}
                  onClick={() => handleToggleCommand(cmd.id)}
                  style={{ opacity: isEnabled ? 1 : 0.55 }}
                >
                  <span className="sensitivity-name">
                    {cmd.icon} {cmd.label}
                  </span>
                  <span className="sensitivity-desc">
                    {isEnabled ? '✓ Activa' : '✕ Desactivada'}
                  </span>
                </button>
              );
            })}
          </div>

          <label className="admin-sublabel" style={{ marginTop: 8 }}>
            Gestos faciales y ojos
          </label>
          <div className="admin-sensitivity-grid">
            {SIMON_COMMAND_POOL.filter((c) => c.category === 'face').map((cmd) => {
              const isEnabled = !disabledSet.has(cmd.id);
              return (
                <button
                  key={cmd.id}
                  type="button"
                  id={`toggle-cmd-${cmd.id}`}
                  className={`admin-sensitivity-btn ${isEnabled ? 'active' : ''}`}
                  onClick={() => handleToggleCommand(cmd.id)}
                  style={{ opacity: isEnabled ? 1 : 0.55 }}
                >
                  <span className="sensitivity-name">
                    {cmd.icon} {cmd.label}
                  </span>
                  <span className="sensitivity-desc">
                    {isEnabled ? '✓ Activa' : '✕ Desactivada'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="admin-divider" />

        {/* ── Detecciones mientras pasan (antes de empezar el juego) ── */}
        <section className="admin-section" id="admin-ambient-section">
          <div className="admin-row-between">
            <label className="admin-label" style={{ marginBottom: 0 }}>
              Detecciones mientras pasan
              <span className="admin-value-badge">
                {showAmbientTag ? `${enabledAmbientCount}/${AMBIENT_SIGNALS.length}` : 'Ocultas'}
              </span>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-ghost admin-mini-btn"
                onClick={() =>
                  update({
                    disabledAmbientSignals: AMBIENT_SIGNALS.map((s) => s.id),
                  })
                }
              >
                Ninguna
              </button>
              <button
                type="button"
                className="btn btn-ghost admin-mini-btn"
                onClick={() =>
                  update({
                    disabledAmbientSignals: DEFAULT_DISABLED_AMBIENT_SIGNALS,
                    showAmbientTag: true,
                    showAmbientMotion: true,
                  })
                }
              >
                Recomendadas
              </button>
              <button
                type="button"
                className="btn btn-ghost admin-mini-btn"
                onClick={() =>
                  update({
                    disabledAmbientSignals: [],
                    showAmbientTag: true,
                    showAmbientMotion: true,
                  })
                }
              >
                Todas
              </button>
            </div>
          </div>
          <p className="admin-hint">
            Controlá qué ve la gente en pantalla mientras camina frente al stand antes de tocar <strong>Empezar</strong> (solo se muestran cuando superan el 65% de confianza).
          </p>

          <label className="admin-toggle">
            <input
              type="checkbox"
              id="show-ambient-tag"
              checked={showAmbientTag}
              onChange={(e) => update({ showAmbientTag: e.target.checked })}
            />
            <span className="admin-toggle-body">
              <span className="admin-toggle-name">Mostrar etiqueta flotante sobre la persona (PERSONA #01)</span>
              <span className="admin-toggle-desc">
                Dibuja el cartel al lado de la cabeza de quien pasa con lo que el sistema detecta en vivo.
              </span>
            </span>
          </label>

          {showAmbientTag && (
            <>
              <label className="admin-toggle">
                <input
                  type="checkbox"
                  id="show-ambient-motion"
                  checked={showAmbientMotion}
                  onChange={(e) => update({ showAmbientMotion: e.target.checked })}
                />
                <span className="admin-toggle-body">
                  <span className="admin-toggle-name">Mostrar si está caminando o quieto (🚶 ← caminando / 🧍 quieto)</span>
                  <span className="admin-toggle-desc">
                    Indica en la etiqueta la dirección en que camina o si se detuvo frente a la cámara.
                  </span>
                </span>
              </label>

              <label className="admin-sublabel" style={{ marginTop: 6 }}>
                Posturas detectadas al pasar
              </label>
              <div className="admin-sensitivity-grid">
                {AMBIENT_POSE_SIGNALS.map((sig) => {
                  const isEnabled = !disabledAmbientSet.has(sig.id);
                  return (
                    <button
                      key={sig.id}
                      type="button"
                      id={`toggle-ambient-${sig.id}`}
                      className={`admin-sensitivity-btn ${isEnabled ? 'active' : ''}`}
                      onClick={() => handleToggleAmbientSignal(sig.id)}
                      style={{ opacity: isEnabled ? 1 : 0.55 }}
                    >
                      <span className="sensitivity-name">
                        {sig.icon} {sig.label}
                      </span>
                      <span className="sensitivity-desc">
                        {isEnabled ? '✓ Visible' : '✕ Oculta'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <label className="admin-sublabel" style={{ marginTop: 8 }}>
                Gestos faciales detectados al pasar
              </label>
              <div className="admin-sensitivity-grid">
                {AMBIENT_FACE_SIGNALS.map((sig) => {
                  const isEnabled = !disabledAmbientSet.has(sig.id);
                  return (
                    <button
                      key={sig.id}
                      type="button"
                      id={`toggle-ambient-${sig.id}`}
                      className={`admin-sensitivity-btn ${isEnabled ? 'active' : ''}`}
                      onClick={() => handleToggleAmbientSignal(sig.id)}
                      style={{ opacity: isEnabled ? 1 : 0.55 }}
                    >
                      <span className="sensitivity-name">
                        {sig.icon} {sig.label}
                      </span>
                      <span className="sensitivity-desc">
                        {isEnabled ? '✓ Visible' : '✕ Oculta'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>

        <div className="admin-divider" />

        {isSimon ? (
          <>
            {/* Simon Says: round length preset */}
            <section className="admin-section">
              <label className="admin-label">Duración de la ronda</label>
              <div className="admin-sensitivity-grid">
                {Object.entries(SIMON_PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    id={`simon-preset-${key}`}
                    className={`admin-sensitivity-btn ${simonPreset === key ? 'active' : ''}`}
                    onClick={() => handleSelectSimonPreset(key)}
                  >
                    <span className="sensitivity-name">{p.label}</span>
                    <span className="sensitivity-desc">{p.description}</span>
                  </button>
                ))}
              </div>
            </section>

            <div className="admin-divider" />

            {/* Simon Says: reward thresholds */}
            <section className="admin-section">
              <label className="admin-label" htmlFor="sticker-slider">
                Puntos para sticker
                <span className="admin-value-badge">{simonStickerThreshold} pts</span>
              </label>
              <div className="admin-slider-wrap">
                <span className="admin-range-hint">{MIN_REWARD_THRESHOLD}</span>
                <input
                  id="sticker-slider"
                  type="range"
                  min={MIN_REWARD_THRESHOLD}
                  max={MAX_REWARD_THRESHOLD}
                  step={5}
                  value={simonStickerThreshold}
                  onChange={(e) => update({ simonStickerThreshold: Number(e.target.value) })}
                  className="admin-slider"
                />
                <span className="admin-range-hint">{MAX_REWARD_THRESHOLD}</span>
              </div>

              <label className="admin-label" htmlFor="pen-slider" style={{ marginTop: 10 }}>
                Puntos para lapicera
                <span className="admin-value-badge">{simonPenThreshold} pts</span>
              </label>
              <div className="admin-slider-wrap">
                <span className="admin-range-hint">{MIN_REWARD_THRESHOLD}</span>
                <input
                  id="pen-slider"
                  type="range"
                  min={MIN_REWARD_THRESHOLD}
                  max={MAX_REWARD_THRESHOLD}
                  step={5}
                  value={simonPenThreshold}
                  onChange={(e) => update({ simonPenThreshold: Number(e.target.value) })}
                  className="admin-slider"
                />
                <span className="admin-range-hint">{MAX_REWARD_THRESHOLD}</span>
              </div>
              <p className="admin-hint">
                Al llegar a {simonStickerThreshold} puntos el jugador se gana un sticker; a {simonPenThreshold}, una lapicera.
              </p>

              {/* Live readout — the current command and score relayed from the game tab */}
              <div className="admin-meter">
                <p className="admin-hint">
                  {isConnected && telemetry?.hasLiveReading
                    ? <>Comando en vivo: <strong>{telemetry.currentCommandLabel}</strong> ({telemetry.commandIndex + 1}/{telemetry.totalCommands}) · Puntaje: <strong>{telemetry.score}</strong></>
                    : isConnected
                      ? 'El comando y el puntaje en vivo aparecen mientras se juega una ronda.'
                      : 'Abrí la pantalla de juego en otra pestaña para ver la lectura en vivo.'}
                </p>
              </div>
            </section>

            <div className="admin-divider" />
          </>
        ) : (
          <>
            {/* Freeze duration */}
            <section className="admin-section">
              <label className="admin-label" htmlFor="freeze-slider">
                Tiempo para ganar
                <span className="admin-value-badge">{freezeSeconds}s</span>
              </label>
              <div className="admin-slider-wrap">
                <span className="admin-range-hint">{MIN_FREEZE_SECONDS}s</span>
                <input
                  id="freeze-slider"
                  type="range"
                  min={MIN_FREEZE_SECONDS}
                  max={MAX_FREEZE_SECONDS}
                  step={1}
                  value={freezeSeconds}
                  onChange={(e) => update({ freezeSeconds: Number(e.target.value) })}
                  className="admin-slider"
                />
                <span className="admin-range-hint">{MAX_FREEZE_SECONDS}s</span>
              </div>
              <p className="admin-hint">
                El jugador debe permanecer quieto durante <strong>{freezeSeconds} segundo{freezeSeconds !== 1 ? 's' : ''}</strong> sin moverse.
              </p>
            </section>

            <div className="admin-divider" />

            {/* Sensitivity */}
            <section className="admin-section">
              <label className="admin-label">Sensibilidad de detección</label>
              <div className="admin-sensitivity-grid">
                {Object.entries(SENSITIVITY_LEVELS).map(([key, level]) => (
                  <button
                    key={key}
                    id={`sensitivity-${key}`}
                    className={`admin-sensitivity-btn ${sensitivity === key ? 'active' : ''}`}
                    onClick={() => handleSelectSensitivityPreset(key)}
                  >
                    <span className="sensitivity-name">{level.label}</span>
                    <span className="sensitivity-desc">{level.description}</span>
                  </button>
                ))}
              </div>

              {/* Live meter — the real movement reading relayed from the game tab */}
              <div className="admin-meter">
                <div className="admin-meter-track">
                  <div
                    className={`admin-meter-fill ${isOverThreshold ? 'over' : ''}`}
                    style={{ width: `${meterPercent}%` }}
                  />
                  <div className="admin-meter-threshold-line" style={{ left: `${100 / METER_HEADROOM}%` }} />
                </div>
                <p className="admin-hint">
                  {hasLiveReading
                    ? <>Movimiento en vivo: <strong>{movementScore.toFixed(4)}</strong> · umbral: <strong>{activeThreshold.toFixed(4)}</strong></>
                    : isConnected
                      ? 'La lectura en vivo aparece mientras se juega una ronda.'
                      : 'Abrí la pantalla de juego en otra pestaña para ver la lectura en vivo.'}
                </p>
              </div>
            </section>

            <div className="admin-divider" />

            <section className="admin-section">
              <label className="admin-label">Señales faciales</label>

              <label className="admin-toggle">
                <input
                  type="checkbox"
                  id="detect-gestures"
                  checked={detectGestures}
                  onChange={(e) => update({ detectGestures: e.target.checked })}
                />
                <span className="admin-toggle-body">
                  <span className="admin-toggle-name">Penalizar gestos faciales</span>
                  <span className="admin-toggle-desc">
                    Sonreír, abrir la boca o levantar las cejas termina la ronda.
                  </span>
                </span>
              </label>

              <label className="admin-toggle">
                <input
                  type="checkbox"
                  id="detect-blink"
                  checked={detectBlink}
                  onChange={(e) => update({ detectBlink: e.target.checked })}
                />
                <span className="admin-toggle-body">
                  <span className="admin-toggle-name">Detectar parpadeo</span>
                  <span className="admin-toggle-desc">
                    Con tolerancia 0, el primer parpadeo delata al jugador.
                  </span>
                </span>
              </label>
            </section>

            <div className="admin-divider" />

            <section className="admin-section">
              <label className="admin-label">
                Parpadeos tolerados
                <span className="admin-value">
                  {blinkBudget === 0 ? 'Ninguno' : blinkBudget}
                </span>
              </label>
              <p className="admin-hint">
                Cuántos parpadeos se le toleran al jugador antes de que el sistema
                lo dé por detectado.
              </p>
              <div className="admin-sensitivity-grid admin-blink-grid">
                {BLINK_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.value)}
                    id={`blink-${opt.value}`}
                    className={`admin-sensitivity-btn ${blinkBudget === opt.value ? 'active' : ''}`}
                    onClick={() => update({ blinkBudget: opt.value })}
                  >
                    <span className="sensitivity-name">{opt.label}</span>
                  </button>
                ))}
              </div>
            </section>

            <div className="admin-divider" />
          </>
        )}

        {/* ── 5. Parámetros Avanzados (Sin tocar código) ── */}
        <section className="admin-section" id="admin-advanced-section">
          <button
            type="button"
            className="admin-collapse-btn"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
          >
            <span>⚙️ Ajuste fino de parámetros (sin tocar código)</span>
            <span>{showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && (
            <div className="admin-advanced-body animate-fadeIn">
              {/* Modelo MediaPipe */}
              <label className="admin-label" htmlFor="pose-conf-slider">
                Confianza mínima del modelo Pose
                <span className="admin-value-badge">{Math.round(minPoseConfidence * 100)}%</span>
              </label>
              <div className="admin-slider-wrap">
                <span className="admin-range-hint">25%</span>
                <input
                  id="pose-conf-slider"
                  type="range"
                  min={0.25}
                  max={0.90}
                  step={0.05}
                  value={minPoseConfidence}
                  onChange={(e) => update({ minPoseConfidence: Number(e.target.value) })}
                  className="admin-slider"
                />
                <span className="admin-range-hint">90%</span>
              </div>

              {isSimon ? (
                <>
                  <label className="admin-label" htmlFor="simon-count-slider" style={{ marginTop: 8 }}>
                    Cantidad de comandos por ronda
                    <span className="admin-value-badge">{simonCommandCount}</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">3</span>
                    <input
                      id="simon-count-slider"
                      type="range"
                      min={3}
                      max={20}
                      step={1}
                      value={simonCommandCount}
                      onChange={(e) => update({ simonCommandCount: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">20</span>
                  </div>

                  <label className="admin-label" htmlFor="simon-sec-slider" style={{ marginTop: 8 }}>
                    Tiempo por comando
                    <span className="admin-value-badge">{simonCommandSeconds}s</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">1.5s</span>
                    <input
                      id="simon-sec-slider"
                      type="range"
                      min={1.5}
                      max={10}
                      step={0.5}
                      value={simonCommandSeconds}
                      onChange={(e) => update({ simonCommandSeconds: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">10s</span>
                  </div>

                  <label className="admin-label" htmlFor="simon-confirm-slider" style={{ marginTop: 8 }}>
                    Cuadros de confirmación de postura
                    <span className="admin-value-badge">{simonConfirmFrames} cuadros</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">1</span>
                    <input
                      id="simon-confirm-slider"
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={simonConfirmFrames}
                      onChange={(e) => update({ simonConfirmFrames: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">10</span>
                  </div>

                  <label className="admin-label" htmlFor="simon-up-margin" style={{ marginTop: 8 }}>
                    Margen "Brazos arriba"
                    <span className="admin-value-badge">{simonArmsUpMargin.toFixed(2)}</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0.02</span>
                    <input
                      id="simon-up-margin"
                      type="range"
                      min={0.02}
                      max={0.40}
                      step={0.01}
                      value={simonArmsUpMargin}
                      onChange={(e) => update({ simonArmsUpMargin: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">0.40</span>
                  </div>

                  <label className="admin-label" htmlFor="simon-down-margin" style={{ marginTop: 8 }}>
                    Margen "Brazos abajo"
                    <span className="admin-value-badge">{simonArmsDownMargin.toFixed(2)}</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0.02</span>
                    <input
                      id="simon-down-margin"
                      type="range"
                      min={0.02}
                      max={0.40}
                      step={0.01}
                      value={simonArmsDownMargin}
                      onChange={(e) => update({ simonArmsDownMargin: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">0.40</span>
                  </div>

                  <label className="admin-label" htmlFor="simon-touch-margin" style={{ marginTop: 8 }}>
                    Margen "Tocarse nariz / cabeza"
                    <span className="admin-value-badge">{simonTouchMargin.toFixed(2)}</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0.05</span>
                    <input
                      id="simon-touch-margin"
                      type="range"
                      min={0.05}
                      max={0.45}
                      step={0.01}
                      value={simonTouchMargin}
                      onChange={(e) => update({ simonTouchMargin: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">0.45</span>
                  </div>
                </>
              ) : (
                <>
                  <label className="admin-label" htmlFor="dyn-thresh-slider" style={{ marginTop: 8 }}>
                    Umbral de velocidad (movimiento corto)
                    <span className="admin-value-badge">{customDynamicThreshold.toFixed(3)}</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0.003</span>
                    <input
                      id="dyn-thresh-slider"
                      type="range"
                      min={0.003}
                      max={0.060}
                      step={0.001}
                      value={customDynamicThreshold}
                      onChange={(e) => update({ customDynamicThreshold: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">0.060</span>
                  </div>

                  <label className="admin-label" htmlFor="anchor-thresh-slider" style={{ marginTop: 8 }}>
                    Umbral de deriva respecto al inicio (ancla)
                    <span className="admin-value-badge">{customAnchorThreshold.toFixed(3)}</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0.008</span>
                    <input
                      id="anchor-thresh-slider"
                      type="range"
                      min={0.008}
                      max={0.120}
                      step={0.002}
                      value={customAnchorThreshold}
                      onChange={(e) => update({ customAnchorThreshold: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">0.120</span>
                  </div>

                  <label className="admin-label" htmlFor="gesture-thresh-slider" style={{ marginTop: 8 }}>
                    Umbral de gestos faciales
                    <span className="admin-value-badge">{customGestureThreshold.toFixed(2)}</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0.05</span>
                    <input
                      id="gesture-thresh-slider"
                      type="range"
                      min={0.05}
                      max={0.50}
                      step={0.01}
                      value={customGestureThreshold}
                      onChange={(e) => update({ customGestureThreshold: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">0.50</span>
                  </div>

                  <label className="admin-label" htmlFor="breach-frames-slider" style={{ marginTop: 8 }}>
                    Cuadros consecutivos para confirmar infracción
                    <span className="admin-value-badge">{breachConfirmFrames} cuadros</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">1</span>
                    <input
                      id="breach-frames-slider"
                      type="range"
                      min={1}
                      max={15}
                      step={1}
                      value={breachConfirmFrames}
                      onChange={(e) => update({ breachConfirmFrames: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">15</span>
                  </div>

                  <label className="admin-label" htmlFor="pose-grace-slider" style={{ marginTop: 8 }}>
                    Tiempo de gracia si se pierde la pose
                    <span className="admin-value-badge">{poseLossGraceMs} ms</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">200ms</span>
                    <input
                      id="pose-grace-slider"
                      type="range"
                      min={200}
                      max={3000}
                      step={100}
                      value={poseLossGraceMs}
                      onChange={(e) => update({ poseLossGraceMs: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">3s</span>
                  </div>

                  <div className="admin-divider" style={{ margin: '10px 0' }} />
                  <p className="admin-hint">
                    <strong>Pesos por zona corporal</strong> — Poné una zona en <strong>0.0</strong> para desactivarla (por ejemplo, <em>Piernas = 0</em> si hay un mostrador tapándolas).
                  </p>

                  <label className="admin-label" htmlFor="weight-head-slider">
                    Peso: Cabeza
                    <span className="admin-value-badge">{zoneWeightHead.toFixed(1)}×</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0</span>
                    <input
                      id="weight-head-slider"
                      type="range"
                      min={0}
                      max={3}
                      step={0.1}
                      value={zoneWeightHead}
                      onChange={(e) => update({ zoneWeightHead: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">3.0</span>
                  </div>

                  <label className="admin-label" htmlFor="weight-torso-slider">
                    Peso: Torso
                    <span className="admin-value-badge">{zoneWeightTorso.toFixed(1)}×</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0</span>
                    <input
                      id="weight-torso-slider"
                      type="range"
                      min={0}
                      max={3}
                      step={0.1}
                      value={zoneWeightTorso}
                      onChange={(e) => update({ zoneWeightTorso: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">3.0</span>
                  </div>

                  <label className="admin-label" htmlFor="weight-arms-slider">
                    Peso: Brazos
                    <span className="admin-value-badge">{zoneWeightArms.toFixed(1)}×</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0</span>
                    <input
                      id="weight-arms-slider"
                      type="range"
                      min={0}
                      max={3}
                      step={0.1}
                      value={zoneWeightArms}
                      onChange={(e) => update({ zoneWeightArms: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">3.0</span>
                  </div>

                  <label className="admin-label" htmlFor="weight-legs-slider">
                    Peso: Piernas
                    <span className="admin-value-badge">{zoneWeightLegs.toFixed(1)}×</span>
                  </label>
                  <div className="admin-slider-wrap">
                    <span className="admin-range-hint">0</span>
                    <input
                      id="weight-legs-slider"
                      type="range"
                      min={0}
                      max={3}
                      step={0.1}
                      value={zoneWeightLegs}
                      onChange={(e) => update({ zoneWeightLegs: Number(e.target.value) })}
                      className="admin-slider"
                    />
                    <span className="admin-range-hint">3.0</span>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            id="reset-defaults-btn"
            className="btn btn-ghost admin-clear-leaderboard-btn"
            onClick={handleResetDefaults}
          >
            Restaurar valores de fábrica
          </button>
        </section>

        <div className="admin-divider" />

        {/* Footer — tech info lives here */}
        <div className="admin-footer">
          <div className="admin-tech-badge">
            <span className="tech-dot" style={{ background: 'var(--signal)' }} />
            MediaPipe Pose + Face Landmarker ({reportedDelegate})
          </div>
          <div className="admin-tech-badge">
            <span className="tech-dot" style={{ background: 'var(--pulse)' }} />
            C.U.I.D.A. Vision Engine
          </div>
        </div>
      </div>
    </div>
  );
}
