// Guitar string frequencies for open tuning and chords
// [E2, A2, D3, G3, B3, E4] - standard tuning
// 0 = muted string

export const CHORDS: Record<string, { name: string; frequencies: number[] }> = {
  open: { name: 'Open', frequencies: [82.41, 110.0, 146.83, 196.0, 246.94, 329.63] },
  E:    { name: 'E',    frequencies: [82.41, 123.47, 164.81, 207.65, 246.94, 329.63] },
  Em:   { name: 'Em',   frequencies: [82.41, 123.47, 164.81, 196.0, 246.94, 329.63] },
  A:    { name: 'A',    frequencies: [0, 110.0, 164.81, 220.0, 277.18, 329.63] },
  Am:   { name: 'Am',   frequencies: [0, 110.0, 164.81, 220.0, 261.63, 329.63] },
  C:    { name: 'C',    frequencies: [0, 130.81, 164.81, 196.0, 261.63, 329.63] },
  D:    { name: 'D',    frequencies: [0, 0, 146.83, 220.0, 293.66, 369.99] },
  Dm:   { name: 'Dm',   frequencies: [0, 0, 146.83, 220.0, 261.63, 349.23] },
  F:    { name: 'F',    frequencies: [0, 0, 174.61, 220.0, 261.63, 349.23] },
  G:    { name: 'G',    frequencies: [98.0, 123.47, 146.83, 196.0, 246.94, 392.0] },
  B7:   { name: 'B7',   frequencies: [0, 123.47, 185.0, 220.0, 246.94, 311.13] },
  A7:   { name: 'A7',   frequencies: [0, 110.0, 164.81, 207.65, 261.63, 329.63] },
  D7:   { name: 'D7',   frequencies: [0, 0, 146.83, 220.0, 261.63, 349.23] },
};

let audioCtx: AudioContext | null = null;
let compressor: DynamicsCompressorNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.1;
    compressor.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function pluckString(freq: number, startTime: number, velocity: number = 0.7) {
  if (freq === 0) return;
  const ctx = getAudioContext();
  const dest = compressor || ctx.destination;

  const duration = 2.0;
  const vol = velocity * 0.18;

  // Main tone - triangle wave for warmth
  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;

  // 2nd harmonic
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2;

  // 3rd harmonic (quieter)
  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 3;

  // Gain envelopes
  const g1 = ctx.createGain();
  g1.gain.setValueAtTime(vol, startTime);
  g1.gain.exponentialRampToValueAtTime(vol * 0.3, startTime + 0.05);
  g1.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(vol * 0.4, startTime);
  g2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.6);

  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(vol * 0.15, startTime);
  g3.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.3);

  // Filter sweep for natural decay
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(4000 + freq * 4, startTime);
  filter.frequency.exponentialRampToValueAtTime(300, startTime + duration);
  filter.Q.value = 1.5;

  // Pick noise burst
  const noiseLen = 0.03;
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(vol * 0.6, startTime);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, startTime + noiseLen);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = freq * 3;
  noiseFilter.Q.value = 2;

  // Connect
  osc1.connect(g1);
  osc2.connect(g2);
  osc3.connect(g3);
  g1.connect(filter);
  g2.connect(filter);
  g3.connect(filter);
  filter.connect(dest);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(dest);

  // Start & stop
  osc1.start(startTime);
  osc2.start(startTime);
  osc3.start(startTime);
  noise.start(startTime);

  osc1.stop(startTime + duration);
  osc2.stop(startTime + duration);
  osc3.stop(startTime + duration);
  noise.stop(startTime + noiseLen);
}

// Play a single string by index
export function playSingleString(chordKey: string, stringIndex: number) {
  const ctx = getAudioContext();
  const chord = CHORDS[chordKey] || CHORDS['open'];
  const freq = chord.frequencies[stringIndex];
  if (freq > 0) {
    pluckString(freq, ctx.currentTime, 0.7);
  }
}

// Ensure audio context is ready (call on first user interaction)
export function initAudio() {
  getAudioContext();
}
