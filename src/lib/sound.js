/**
 * sound.js
 *
 * A tiny Web Audio synth for feedback chimes — no audio file to ship or
 * fetch, consistent with the rest of the app running from zero external
 * assets.
 */
let sharedCtx = null;

function getContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!sharedCtx) sharedCtx = new AudioContextClass();
  if (sharedCtx.state === 'suspended') sharedCtx.resume();
  return sharedCtx;
}

function tone(ctx, freq, startTime, duration, gain) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

/** Short ascending triumphant chime — played whenever a prize is unlocked. */
export function playVictorySound() {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
  notes.forEach((freq, i) => tone(ctx, freq, now + i * 0.12, 0.35, 0.22));
}

/**
 * Called from the "Empezar" click so the AudioContext is unlocked by a real
 * user gesture — the victory chime fires later, asynchronously, from a pose
 * detection callback, which browsers otherwise block from starting audio.
 */
export function primeAudio() {
  getContext();
}
