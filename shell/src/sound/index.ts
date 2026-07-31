export type SfxName =
  | 'tick'
  | 'edge'
  | 'accept'
  | 'back'
  | 'launch'
  | 'homecoming'
  | 'shelfOpen'
  | 'shelfClose'
  | 'pair';

const SILENCE = 0.0001;
const MASTER_GAIN = 0.25; // Roughly -12 dB at the loudest volume setting.
const AMBIENT_DUCK_GAIN = 0.22;

type AudioGraph = {
  context: AudioContext;
  master: GainNode;
  sfx: GainNode;
  ambientDuck: GainNode;
  noise: AudioBuffer;
};

type AmbientVoice = {
  carriers: OscillatorNode[];
  carrierGains: GainNode[];
  modulators: OscillatorNode[];
  modulatorGains: GainNode[];
  filter: BiquadFilterNode;
  level: GainNode;
};

type MalletOptions = {
  duration?: number;
  volume?: number;
  attackFrequency?: number;
  attackAmount?: number;
};

let graph: AudioGraph | null = null;
let ambient: AmbientVoice | null = null;
let ambientRequested = false;
let ambientDucked = false;
let volume = 1;

function rampEnvelope(
  param: AudioParam,
  at: number,
  peak: number,
  attack: number,
  end: number,
): void {
  param.setValueAtTime(SILENCE, at);
  param.exponentialRampToValueAtTime(Math.max(SILENCE, peak), at + attack);
  param.exponentialRampToValueAtTime(SILENCE, at + end);
}

function disconnectMallet(
  oscillator: OscillatorNode,
  envelope: GainNode,
): void {
  oscillator.disconnect();
  envelope.disconnect();
}

/**
 * A compact kalimba/marimba voice. The upper partials are intentionally a
 * little inharmonic; that small imperfection keeps the sound woody instead
 * of reading as a plain synthesizer beep.
 */
function playMallet(
  audio: AudioGraph,
  frequency: number,
  at: number,
  options: MalletOptions = {},
): void {
  const {
    duration = 0.34,
    volume: voiceVolume = 0.32,
    attackFrequency = 1_500,
    attackAmount = 0.16,
  } = options;
  const partials = [
    { ratio: 1, amount: 1, type: 'sine' as OscillatorType, decay: 1 },
    { ratio: 2.01, amount: 0.24, type: 'triangle' as OscillatorType, decay: 0.57 },
    { ratio: 3.97, amount: 0.09, type: 'sine' as OscillatorType, decay: 0.34 },
  ];

  for (const partial of partials) {
    const oscillator = audio.context.createOscillator();
    const envelope = audio.context.createGain();
    const partialDuration = Math.max(0.055, duration * partial.decay);

    oscillator.type = partial.type;
    oscillator.frequency.setValueAtTime(frequency * partial.ratio, at);
    oscillator.detune.setValueAtTime((Math.random() - 0.5) * 4, at);
    rampEnvelope(
      envelope.gain,
      at,
      voiceVolume * partial.amount,
      0.004,
      partialDuration,
    );

    oscillator.connect(envelope).connect(audio.sfx);
    oscillator.addEventListener(
      'ended',
      () => disconnectMallet(oscillator, envelope),
      { once: true },
    );
    oscillator.start(at);
    oscillator.stop(at + partialDuration + 0.025);
  }

  if (attackAmount > 0) {
    playNoiseTransient(
      audio,
      at,
      Math.min(0.055, duration * 0.22),
      voiceVolume * attackAmount,
      attackFrequency,
    );
  }
}

function playNoiseTransient(
  audio: AudioGraph,
  at: number,
  duration: number,
  peak: number,
  frequency: number,
): void {
  const source = audio.context.createBufferSource();
  const filter = audio.context.createBiquadFilter();
  const envelope = audio.context.createGain();
  const availableOffset = Math.max(0, audio.noise.duration - duration - 0.01);

  source.buffer = audio.noise;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency, at);
  filter.Q.setValueAtTime(0.7, at);
  rampEnvelope(envelope.gain, at, peak, 0.002, duration);

  source.connect(filter).connect(envelope).connect(audio.sfx);
  source.addEventListener(
    'ended',
    () => {
      source.disconnect();
      filter.disconnect();
      envelope.disconnect();
    },
    { once: true },
  );
  source.start(at, Math.random() * availableOffset, duration);
}

function playWhoosh(
  audio: AudioGraph,
  at: number,
  duration: number,
  rising: boolean,
  peak: number,
): void {
  const source = audio.context.createBufferSource();
  const bandpass = audio.context.createBiquadFilter();
  const lowpass = audio.context.createBiquadFilter();
  const envelope = audio.context.createGain();
  const startFrequency = rising ? 190 : 1_450;
  const endFrequency = rising ? 1_450 : 190;
  const availableOffset = Math.max(0, audio.noise.duration - duration - 0.01);

  source.buffer = audio.noise;
  bandpass.type = 'bandpass';
  bandpass.Q.setValueAtTime(0.55, at);
  bandpass.frequency.setValueAtTime(startFrequency, at);
  bandpass.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(2_100, at);
  lowpass.Q.setValueAtTime(0.35, at);

  envelope.gain.setValueAtTime(SILENCE, at);
  envelope.gain.exponentialRampToValueAtTime(peak, at + duration * 0.36);
  envelope.gain.exponentialRampToValueAtTime(SILENCE, at + duration);

  source
    .connect(bandpass)
    .connect(lowpass)
    .connect(envelope)
    .connect(audio.sfx);
  source.addEventListener(
    'ended',
    () => {
      source.disconnect();
      bandpass.disconnect();
      lowpass.disconnect();
      envelope.disconnect();
    },
    { once: true },
  );
  source.start(at, Math.random() * availableOffset, duration);
}

function playEffect(audio: AudioGraph, name: SfxName): void {
  const now = audio.context.currentTime;

  switch (name) {
    case 'tick':
      playMallet(audio, 783.99, now, {
        duration: 0.12,
        volume: 0.17,
        attackFrequency: 1_850,
        attackAmount: 0.23,
      });
      break;

    case 'edge':
      playMallet(audio, 130.81, now, {
        duration: 0.16,
        volume: 0.13,
        attackFrequency: 520,
        attackAmount: 0.32,
      });
      break;

    case 'accept':
      playMallet(audio, 523.25, now, { duration: 0.31, volume: 0.27 });
      playMallet(audio, 659.25, now + 0.085, {
        duration: 0.38,
        volume: 0.25,
      });
      break;

    case 'back':
      playMallet(audio, 440, now, {
        duration: 0.24,
        volume: 0.2,
        attackFrequency: 1_100,
      });
      playMallet(audio, 293.66, now + 0.075, {
        duration: 0.31,
        volume: 0.17,
        attackFrequency: 900,
      });
      break;

    case 'launch':
      playWhoosh(audio, now, 0.62, true, 0.19);
      playMallet(audio, 261.63, now + 0.25, {
        duration: 0.55,
        volume: 0.24,
      });
      playMallet(audio, 329.63, now + 0.34, {
        duration: 0.61,
        volume: 0.25,
      });
      playMallet(audio, 440, now + 0.43, {
        duration: 0.72,
        volume: 0.27,
      });
      break;

    case 'homecoming':
      playWhoosh(audio, now, 0.51, false, 0.11);
      playMallet(audio, 440, now, { duration: 0.54, volume: 0.23 });
      playMallet(audio, 329.63, now + 0.08, {
        duration: 0.5,
        volume: 0.22,
      });
      playMallet(audio, 261.63, now + 0.16, {
        duration: 0.62,
        volume: 0.24,
      });
      break;

    case 'shelfOpen':
      playMallet(audio, 293.66, now, { duration: 0.3, volume: 0.2 });
      playMallet(audio, 440, now + 0.09, {
        duration: 0.4,
        volume: 0.21,
      });
      break;

    case 'shelfClose':
      playMallet(audio, 440, now, { duration: 0.25, volume: 0.18 });
      playMallet(audio, 293.66, now + 0.07, {
        duration: 0.34,
        volume: 0.17,
      });
      break;

    case 'pair':
      playMallet(audio, 587.33, now, {
        duration: 0.45,
        volume: 0.24,
        attackFrequency: 1_650,
      });
      playMallet(audio, 880, now + 0.22, {
        duration: 0.68,
        volume: 0.26,
        attackFrequency: 1_900,
      });
      break;
  }
}

function makeNoiseBuffer(context: AudioContext): AudioBuffer {
  // Reusing one generated buffer avoids allocating a large random buffer for
  // every click. Random start offsets keep repeated ticks from sounding cloned.
  const duration = 1.25;
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * duration),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  let previous = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const white = Math.random() * 2 - 1;
    // A touch of correlation takes the brittle edge off raw white noise.
    previous = previous * 0.18 + white * 0.82;
    samples[i] = previous;
  }

  return buffer;
}

function createGraph(context: AudioContext): AudioGraph {
  const master = context.createGain();
  const sfx = context.createGain();
  const ambientDuck = context.createGain();
  const limiter = context.createDynamicsCompressor();

  master.gain.value = MASTER_GAIN * volume;
  sfx.gain.value = 0.62;
  ambientDuck.gain.value = ambientDucked ? AMBIENT_DUCK_GAIN : 1;

  limiter.threshold.value = -18;
  limiter.knee.value = 18;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.18;

  sfx.connect(master);
  ambientDuck.connect(master);
  master.connect(limiter).connect(context.destination);

  return {
    context,
    master,
    sfx,
    ambientDuck,
    noise: makeNoiseBuffer(context),
  };
}

function startAmbientNow(audio: AudioGraph): void {
  if (ambient || audio.context.state === 'closed') return;

  const now = audio.context.currentTime;
  const filter = audio.context.createBiquadFilter();
  const level = audio.context.createGain();
  const carriers: OscillatorNode[] = [];
  const carrierGains: GainNode[] = [];
  const modulators: OscillatorNode[] = [];
  const modulatorGains: GainNode[] = [];
  const voices = [
    { frequency: 130.81, amount: 0.33, type: 'sine' as OscillatorType, drift: 3.2, rate: 0.031 },
    { frequency: 196, amount: 0.18, type: 'triangle' as OscillatorType, drift: 4.5, rate: 0.047 },
    { frequency: 293.66, amount: 0.1, type: 'sine' as OscillatorType, drift: 2.6, rate: 0.023 },
  ];

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(640, now);
  filter.Q.setValueAtTime(0.45, now);
  level.gain.setValueAtTime(SILENCE, now);
  level.gain.exponentialRampToValueAtTime(0.15, now + 1.7);
  filter.connect(level).connect(audio.ambientDuck);

  for (const [index, voice] of voices.entries()) {
    const carrier = audio.context.createOscillator();
    const carrierGain = audio.context.createGain();
    const modulator = audio.context.createOscillator();
    const modulatorGain = audio.context.createGain();

    carrier.type = voice.type;
    carrier.frequency.setValueAtTime(voice.frequency, now);
    carrier.detune.setValueAtTime((index - 1) * 3.5, now);
    carrierGain.gain.setValueAtTime(voice.amount, now);

    // Audio-rate connections into detune are measured in cents. Very slow,
    // differently paced LFOs make the chord breathe without an audible wobble.
    modulator.type = 'sine';
    modulator.frequency.setValueAtTime(voice.rate, now);
    modulatorGain.gain.setValueAtTime(voice.drift, now);

    modulator.connect(modulatorGain).connect(carrier.detune);
    carrier.connect(carrierGain).connect(filter);
    carrier.start(now);
    modulator.start(now);

    carriers.push(carrier);
    carrierGains.push(carrierGain);
    modulators.push(modulator);
    modulatorGains.push(modulatorGain);
  }

  const filterModulator = audio.context.createOscillator();
  const filterModulatorGain = audio.context.createGain();
  filterModulator.type = 'sine';
  filterModulator.frequency.setValueAtTime(0.018, now);
  filterModulatorGain.gain.setValueAtTime(135, now);
  filterModulator.connect(filterModulatorGain).connect(filter.frequency);
  filterModulator.start(now);
  modulators.push(filterModulator);
  modulatorGains.push(filterModulatorGain);

  ambient = {
    carriers,
    carrierGains,
    modulators,
    modulatorGains,
    filter,
    level,
  };
}

function stopAmbientNow(audio: AudioGraph): void {
  const voice = ambient;
  if (!voice) return;
  ambient = null;

  const now = audio.context.currentTime;
  const stopAt = now + 0.9;
  voice.level.gain.cancelScheduledValues(now);
  voice.level.gain.setTargetAtTime(SILENCE, now, 0.18);

  const allOscillators = [...voice.carriers, ...voice.modulators];
  for (const oscillator of allOscillators) {
    oscillator.stop(stopAt);
  }

  // One carrier ending is enough to release our JS-side graph references;
  // every source has the same scheduled stop time.
  voice.carriers[0]?.addEventListener(
    'ended',
    () => {
      for (const oscillator of allOscillators) oscillator.disconnect();
      for (const gain of voice.carrierGains) gain.disconnect();
      for (const gain of voice.modulatorGains) gain.disconnect();
      voice.filter.disconnect();
      voice.level.disconnect();
    },
    { once: true },
  );
}

function init(): void {
  if (graph) {
    if (graph.context.state === 'suspended') {
      // Browsers can re-suspend audio after tab switches. Calling init from
      // every gesture doubles as the inexpensive resume path.
      void graph.context.resume().catch(() => undefined);
    }
    return;
  }

  if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') {
    return;
  }

  let context: AudioContext | null = null;
  try {
    context = new AudioContext({ latencyHint: 'interactive' });
    graph = createGraph(context);

    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
    if (ambientRequested) startAmbientNow(graph);
  } catch {
    graph = null;
    if (context && context.state !== 'closed') {
      void context.close().catch(() => undefined);
    }
  }
}

function play(name: SfxName): void {
  const audio = graph;
  // Do not queue effects while autoplay policy has the context suspended:
  // otherwise several inputs can burst out together on a later resume.
  if (!audio || audio.context.state !== 'running') return;

  try {
    playEffect(audio, name);
  } catch {
    // Audio can be torn down by the browser between the state check and node
    // creation. Sound must never be able to break console input handling.
  }
}

function startAmbient(): void {
  ambientRequested = true;
  if (!graph) return;

  try {
    startAmbientNow(graph);
  } catch {
    // A denied or interrupted audio context simply leaves Home silent.
  }
}

function stopAmbient(): void {
  ambientRequested = false;
  if (!graph) return;

  try {
    stopAmbientNow(graph);
  } catch {
    ambient = null;
  }
}

function duck(on: boolean): void {
  ambientDucked = on;
  if (!graph || graph.context.state === 'closed') return;

  const now = graph.context.currentTime;
  const target = on ? AMBIENT_DUCK_GAIN : 1;
  graph.ambientDuck.gain.cancelScheduledValues(now);
  graph.ambientDuck.gain.setTargetAtTime(target, now, on ? 0.06 : 0.22);
}

function setVolume(value: number): void {
  if (!Number.isFinite(value)) return;
  volume = Math.min(1, Math.max(0, value));
  if (!graph || graph.context.state === 'closed') return;

  const now = graph.context.currentTime;
  graph.master.gain.cancelScheduledValues(now);
  graph.master.gain.setTargetAtTime(MASTER_GAIN * volume, now, 0.025);
}

export const sound = {
  init,
  play,
  startAmbient,
  stopAmbient,
  duck,
  setVolume,
};
