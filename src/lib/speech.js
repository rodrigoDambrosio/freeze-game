/**
 * speech.js
 *
 * Spoken feedback for "Simón Dice" via the browser's built-in
 * SpeechSynthesis — this is OS/browser-local text-to-speech, not a network
 * call, so it keeps working with the rest of the app with no internet at all.
 */

function pickSpanishVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const voices = synth.getVoices();
  return voices.find((v) => v.lang?.toLowerCase().startsWith('es')) ?? null;
}

/**
 * Speaks `text` aloud, replacing whatever utterance is already in progress —
 * a new command interrupts the previous one rather than queuing behind it.
 */
export function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-AR';
  const voice = pickSpanishVoice();
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

export function cancelSpeech() {
  window.speechSynthesis?.cancel();
}

/**
 * Called from the "Empezar" click so the first utterance of the round is
 * inside a user-gesture call stack — some browsers otherwise silently drop
 * speech that wasn't triggered that way.
 */
export function primeSpeech() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  // Loads the voice list ahead of the first real utterance; harmless if
  // voices are not ready yet (speak() falls back to the default voice).
  synth.getVoices();
}
