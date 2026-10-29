/**
 * gpuConfig.js
 *
 * Ensures MediaPipe's internal WebGL2 context requests the desired GPU
 * powerPreference ('high-performance' for discrete NVIDIA/AMD GPUs vs
 * 'low-power' for integrated GPUs), provides a dedicated inference canvas,
 * and captures the active WebGL hardware renderer string for live telemetry in #admin.
 */

let currentPowerPreference = 'high-performance';
let detectedGpuRenderer = null;
let detectedGpuVendor = null;
let highPerfRenderer = null;
let lowPowerRenderer = null;
let webGpuHighPerfAdapterName = null;
let patchInstalled = false;

/**
 * Clean up raw UNMASKED_RENDERER_WEBGL strings without truncating parentheses
 * inside GPU names like "AMD Radeon(TM) Graphics" or "Intel(R) UHD Graphics".
 */
export function cleanRendererName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw.trim();

  // Common ANGLE format:
  // "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"
  // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)"
  const angleMatch = cleaned.match(/^ANGLE\s*\(\s*[^,]+,\s*([^,]+)/i);
  if (angleMatch && angleMatch[1]) {
    cleaned = angleMatch[1]
      .replace(/\s*\(?Direct3D.*$/i, '')
      .replace(/\s*\(?OpenGL.*$/i, '')
      .replace(/\s*\(?Vulkan.*$/i, '')
      .replace(/\s+vs_\d+_\d+.*$/i, '')
      .trim();

    // Strip a trailing ')' only if parentheses are unbalanced
    const openCount = (cleaned.match(/\(/g) || []).length;
    const closeCount = (cleaned.match(/\)/g) || []).length;
    if (closeCount > openCount && cleaned.endsWith(')')) {
      cleaned = cleaned.slice(0, -1).trim();
    }
    return cleaned;
  }

  return cleaned;
}

export function isSoftwareRenderer(rendererName) {
  if (!rendererName || typeof rendererName !== 'string') return false;
  const name = rendererName.toLowerCase();
  return (
    name.includes('microsoft basic render') ||
    name.includes('swiftshader') ||
    name.includes('llvmpipe') ||
    name.includes('software')
  );
}

/**
 * Heuristic to detect whether the active WebGL renderer is an integrated GPU
 * (e.g. "AMD Radeon(TM) Graphics" on Ryzen APUs or "Intel(R) UHD/Iris Graphics")
 * rather than a dedicated NVIDIA GeForce / AMD Radeon RX card.
 */
export function isLikelyIntegratedGpu(rendererName) {
  if (!rendererName || typeof rendererName !== 'string') return false;
  if (isSoftwareRenderer(rendererName)) return true;
  const name = rendererName.toLowerCase();
  if (name.includes('nvidia') || name.includes('geforce') || name.includes('quadro') || name.includes('rtx') || name.includes('gtx')) {
    return false;
  }
  if (/radeon\s+rx\s+\d/i.test(rendererName)) {
    return false;
  }
  if (
    name.includes('radeon(tm) graphics') ||
    name.includes('radeon graphics') ||
    name.includes('intel') ||
    name.includes('uhd graphics') ||
    name.includes('iris') ||
    name.includes('vega')
  ) {
    return true;
  }
  return false;
}

function inspectWebGLContext(gl, prefHint = currentPowerPreference) {
  if (!gl) return null;
  try {
    let renderer = null;
    let vendor = null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      const rawRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      const rawVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
      if (rawRenderer) renderer = cleanRendererName(rawRenderer) || rawRenderer;
      if (rawVendor) vendor = rawVendor;
    } else {
      const basicRenderer = gl.getParameter(gl.RENDERER);
      if (basicRenderer) renderer = cleanRendererName(basicRenderer) || basicRenderer;
    }

    if (renderer) {
      detectedGpuRenderer = renderer;
      if (prefHint === 'low-power') {
        lowPowerRenderer = renderer;
      } else {
        highPerfRenderer = renderer;
      }
    }
    if (vendor) detectedGpuVendor = vendor;
    return renderer;
  } catch {
    return null;
  }
}

export function installGpuContextHook() {
  if (patchInstalled || typeof window === 'undefined') return;
  patchInstalled = true;

  const patchProto = (Proto) => {
    if (!Proto || !Proto.prototype || typeof Proto.prototype.getContext !== 'function') return;
    const nativeGetContext = Proto.prototype.getContext;
    Proto.prototype.getContext = function getContextPatched(type, attrs) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
        const requestedPref = attrs?.powerPreference || currentPowerPreference;
        const mergedAttrs = {
          ...(attrs || {}),
          powerPreference: currentPowerPreference,
        };
        const gl = nativeGetContext.call(this, type, mergedAttrs);
        inspectWebGLContext(gl, requestedPref);
        return gl;
      }
      return nativeGetContext.call(this, type, attrs);
    };
  };

  patchProto(window.HTMLCanvasElement);
  if (typeof window.OffscreenCanvas !== 'undefined') {
    patchProto(window.OffscreenCanvas);
  }
}

/**
 * Set the WebGL powerPreference ('high-performance' | 'low-power') before
 * creating/recreating MediaPipe landmarkers, and immediately probe a fresh context.
 */
export function setGpuPowerPreference(pref = 'high-performance') {
  installGpuContextHook();
  currentPowerPreference = pref === 'low-power' ? 'low-power' : 'high-performance';
  probeWebGLPreference(currentPowerPreference);
}

/**
 * Create a dedicated canvas for MediaPipe Vision Tasks.
 * Note: We do NOT call getContext() beforehand so MediaPipe can pass its own
 * required context attributes, while our getContext hook injects powerPreference.
 */
export function createInferenceCanvas(pref = currentPowerPreference) {
  installGpuContextHook();
  currentPowerPreference = pref === 'low-power' ? 'low-power' : 'high-performance';
  if (typeof document === 'undefined') return undefined;
  return document.createElement('canvas');
}

function probeWebGLPreference(pref) {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { powerPreference: pref }) ||
      canvas.getContext('webgl', { powerPreference: pref });
    const renderer = inspectWebGLContext(gl, pref);
    // Release temporary probe context immediately
    const loseCtx = gl?.getExtension('WEBGL_lose_context');
    loseCtx?.loseContext();
    return renderer;
  } catch {
    return null;
  }
}

/**
 * Probe WebGL2 support and return the active GPU renderer name.
 */
export function getGpuHardwareInfo(forceRefresh = false) {
  installGpuContextHook();
  if ((forceRefresh || !detectedGpuRenderer) && typeof document !== 'undefined') {
    probeWebGLPreference(currentPowerPreference);
  }
  const activeRenderer = detectedGpuRenderer || 'WebGL GPU';
  return {
    renderer: activeRenderer,
    vendor: detectedGpuVendor || null,
    powerPreference: currentPowerPreference,
    isIntegrated: isLikelyIntegratedGpu(activeRenderer),
    highPerfRenderer,
    lowPowerRenderer,
    webGpuHighPerfAdapterName,
  };
}

/**
 * Asynchronously probes both WebGL preferences ('high-performance' & 'low-power')
 * and WebGPU (navigator.gpu) if available, to detect if a discrete GPU (e.g. NVIDIA)
 * exists on the machine even when Windows/ANGLE locks WebGL to GPU 0.
 */
export async function probeAllGpus() {
  installGpuContextHook();
  const prevPref = currentPowerPreference;

  setGpuPowerPreference('low-power');
  const lowP = probeWebGLPreference('low-power');

  setGpuPowerPreference('high-performance');
  const highP = probeWebGLPreference('high-performance');

  currentPowerPreference = prevPref;
  probeWebGLPreference(prevPref);

  if (typeof navigator !== 'undefined' && navigator.gpu?.requestAdapter) {
    try {
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (adapter) {
        const info = adapter.info || (typeof adapter.requestAdapterInfo === 'function' ? await adapter.requestAdapterInfo() : null);
        if (info) {
          const desc = info.description || info.device || info.vendor || null;
          if (desc) webGpuHighPerfAdapterName = desc;
        }
      }
    } catch {
      // Ignore WebGPU probe errors
    }
  }

  return getGpuHardwareInfo(false);
}

installGpuContextHook();
