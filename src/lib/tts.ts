const PREFERRED_ENGLISH_VOICE_PATTERNS = [
  /google us english/i,
  /samantha/i,
  /aria/i,
  /jenny/i,
  /zira/i,
  /allison/i,
  /ava/i,
  /serena/i,
  /emma/i
];

let initialized = false;
let cachedVoice: SpeechSynthesisVoice | null = null;

const scoreVoice = (voice: SpeechSynthesisVoice) => {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang === 'en-us') {
    score += 60;
  } else if (lang.startsWith('en-us')) {
    score += 55;
  } else if (lang.startsWith('en')) {
    score += 35;
  }

  if (voice.localService) score += 8;
  if (PREFERRED_ENGLISH_VOICE_PATTERNS.some((pattern) => pattern.test(name))) {
    score += 120;
  }
  if (/enhanced|neural|online/i.test(name)) score += 6;

  return score;
};

const findBestVoice = () => {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const englishVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  const candidates = englishVoices.length > 0 ? englishVoices : voices;
  return [...candidates].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] ?? null;
};

const ensureVoiceReady = () => {
  if (!('speechSynthesis' in window)) return;
  if (!initialized) {
    initialized = true;
    const refresh = () => {
      cachedVoice = findBestVoice();
    };
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
  }
  if (!cachedVoice) {
    cachedVoice = findBestVoice();
  }
};

export const speak = (text: string) => {
  if (!('speechSynthesis' in window)) {
    return false;
  }

  const content = text.trim();
  if (!content) return false;

  ensureVoiceReady();

  const synth = window.speechSynthesis;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(content);
  if (cachedVoice) {
    utterance.voice = cachedVoice;
    utterance.lang = cachedVoice.lang || 'en-US';
  } else {
    utterance.lang = 'en-US';
  }
  utterance.rate = 0.88;
  utterance.pitch = 1.08;
  utterance.volume = 1;
  synth.speak(utterance);
  return true;
};

export const stopSpeaking = () => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
};
