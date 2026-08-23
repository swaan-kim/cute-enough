export type SoundEffect = 'bark' | 'pant' | 'pick' | 'eat' | 'pet' | 'reveal' | 'toggle';

const SOUND_ENABLED_KEY = 'cute-enough:sound-enabled';

let audioContext: AudioContext | undefined;

export function readSoundEnabled() {
  try {
    return window.localStorage.getItem(SOUND_ENABLED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function saveSoundEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  } catch {
    // 저장 공간을 사용할 수 없어도 현재 세션의 소리는 계속 동작해요.
  }
}

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor) return undefined;
  audioContext ??= new AudioContextConstructor();
  return audioContext;
}

function tone(context: AudioContext, startAt: number, frequency: number, duration: number, volume: number, endFrequency = frequency) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), startAt + duration);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + Math.min(0.018, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function softNoise(context: AudioContext, startAt: number, duration: number, volume: number, frequency: number) {
  const frameCount = Math.max(1, Math.floor(context.sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const envelope = 1 - index / frameCount;
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = 'lowpass';
  filter.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  source.buffer = buffer;
  source.connect(filter).connect(gain).connect(context.destination);
  source.start(startAt);
}

function scheduleSound(context: AudioContext, effect: SoundEffect, variant: number) {
  const now = context.currentTime + 0.01;

  if (effect === 'bark') {
    softNoise(context, now, 0.13, 0.055, 920);
    tone(context, now, 175, 0.15, 0.062, 92);
    tone(context, now + 0.012, 340, 0.11, 0.028, 170);
    softNoise(context, now + 0.14, 0.075, 0.026, 760);
    tone(context, now + 0.14, 145, 0.085, 0.032, 90);
    return;
  }
  if (effect === 'pant') {
    [0, 0.13, 0.26].forEach((offset, index) => {
      softNoise(context, now + offset, 0.075, 0.025 - index * 0.003, 1050 - index * 100);
      tone(context, now + offset, 230 - index * 15, 0.065, 0.009, 175 - index * 12);
    });
    return;
  }
  if (effect === 'pick') {
    tone(context, now, 360, 0.06, 0.026, 430);
    return;
  }
  if (effect === 'eat') {
    softNoise(context, now, 0.11, 0.075, 780);
    softNoise(context, now + 0.12, 0.09, 0.06, 650);
    tone(context, now, 170, 0.18, 0.022, 115);
    return;
  }
  if (effect === 'pet') {
    const pitches = [410, 455, 510];
    const pitch = pitches[variant % pitches.length];
    softNoise(context, now, 0.055, 0.022, 520);
    tone(context, now, pitch, 0.085, 0.026, pitch * 1.08);
    return;
  }
  if (effect === 'reveal') {
    [523, 659, 784].forEach((pitch, index) => tone(context, now + index * 0.085, pitch, 0.2, 0.028, pitch * 1.04));
    return;
  }
  tone(context, now, 440, 0.07, 0.025, 550);
}

export function playSoundEffect(effect: SoundEffect, enabled: boolean, variant = 0) {
  if (!enabled) return;
  const context = getAudioContext();
  if (!context) return;

  if (context.state === 'suspended') {
    void context.resume().then(() => scheduleSound(context, effect, variant)).catch(() => undefined);
    return;
  }
  scheduleSound(context, effect, variant);
}
