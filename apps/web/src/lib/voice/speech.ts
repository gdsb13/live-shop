const SYNTH_RATE = 0.94;
const SYNTH_PITCH = 1.02;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  const ranked = [
    (v: SpeechSynthesisVoice) => /google/i.test(v.name) && /english/i.test(v.name) && /female|natural/i.test(v.name),
    (v: SpeechSynthesisVoice) => /microsoft.*natural/i.test(v.name) && v.lang.startsWith('en'),
    (v: SpeechSynthesisVoice) => v.lang === 'en-IN',
    (v: SpeechSynthesisVoice) => v.lang.startsWith('en-IN'),
    (v: SpeechSynthesisVoice) => v.lang.startsWith('en-GB'),
    (v: SpeechSynthesisVoice) => v.lang.startsWith('en-US'),
  ];

  for (const score of ranked) {
    const match = voices.find(score);
    if (match) return match;
  }
  return voices[0];
}

let voicesReady = false;

function ensureVoicesLoaded() {
  if (voicesReady || typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    voicesReady = true;
  };
  voicesReady = window.speechSynthesis.getVoices().length > 0;
}

export function speakText(text: string, onComplete?: () => void) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    onComplete?.();
    return;
  }

  ensureVoicesLoaded();
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-IN';
  utterance.rate = SYNTH_RATE;
  utterance.pitch = SYNTH_PITCH;
  const voice = pickVoice();
  if (voice) utterance.voice = voice;

  const finish = () => onComplete?.();
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}
