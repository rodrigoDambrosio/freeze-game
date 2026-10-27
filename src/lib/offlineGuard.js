/**
 * offlineGuard.js
 *
 * Keeps the app fully local.
 *
 * Everything it needs is bundled or served from /public — the two MediaPipe
 * models, the WASM runtime and the font. One thing still reaches out: the
 * Tasks library POSTs usage telemetry to odml.pa.googleapis.com, with no
 * public option to turn it off.
 *
 * That request is blocked here rather than left to fail. On a machine with no
 * network it would only time out, but this demo processes video of people in
 * their homes, and a monitoring system should not be quietly phoning home
 * about it. Blocking is also what makes "works offline" verifiable instead of
 * incidental.
 *
 * Installs itself on import, so listing it as the first import of the entry
 * module is enough — ES imports are evaluated in order, before any module body.
 */

const BLOCKED_HOSTS = ['odml.pa.googleapis.com'];

function isBlocked(url) {
  if (!url) return false;
  try {
    const { hostname } = new URL(url, window.location.href);
    return BLOCKED_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

export function installOfflineGuard() {
  if (typeof window === 'undefined' || window.__cuidaOfflineGuard) return;
  window.__cuidaOfflineGuard = true;

  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url;
      if (isBlocked(url)) {
        return Promise.resolve(new Response('', { status: 204 }));
      }
      return nativeFetch(input, init);
    };
  }

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    if (isBlocked(url)) {
      // Point it at a data: URL so the request resolves locally and the
      // caller's error handling never runs.
      return nativeOpen.call(this, method, 'data:,', ...rest);
    }
    return nativeOpen.call(this, method, url, ...rest);
  };

  const nativeBeacon = navigator.sendBeacon?.bind(navigator);
  if (nativeBeacon) {
    navigator.sendBeacon = (url, data) =>
      isBlocked(url) ? true : nativeBeacon(url, data);
  }
}

installOfflineGuard();
