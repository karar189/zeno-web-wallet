export type SoundName =
  | "tap"
  | "nav"
  | "copy"
  | "success"
  | "error"
  | "lock"
  | "step";

const STORAGE_KEY = "emperor.sounds.enabled";
const listeners = new Set<() => void>();

let enabled: boolean | null = null;
let context: AudioContext | null = null;
let output: GainNode | null = null;

function readEnabled(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  if (enabled === null) {
    enabled = readEnabled();
  }
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Storage can be unavailable in private modes; the session still respects the toggle.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getContext(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    try {
      context = new Ctor();
      output = context.createGain();
      output.gain.value = 0.6;
      output.connect(context.destination);
    } catch {
      return null;
    }
  }
  return context;
}

export function primeSound(): void {
  const ctx = getContext();
  if (ctx?.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
}

type ToneOptions = {
  frequency: number;
  to?: number;
  duration: number;
  delay?: number;
  gain?: number;
  type?: OscillatorType;
};

function tone(ctx: AudioContext, options: ToneOptions): void {
  const start = ctx.currentTime + (options.delay ?? 0);
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  const peak = options.gain ?? 0.02;

  oscillator.type = options.type ?? "sine";
  oscillator.frequency.setValueAtTime(options.frequency, start);
  if (options.to) {
    oscillator.frequency.exponentialRampToValueAtTime(options.to, start + options.duration);
  }

  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

  oscillator.connect(envelope);
  envelope.connect(output ?? ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + options.duration + 0.03);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
}

type NoiseOptions = {
  duration: number;
  frequency: number;
  delay?: number;
  gain?: number;
};

function noise(ctx: AudioContext, options: NoiseOptions): void {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * options.duration));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = options.frequency;
  filter.Q.value = 0.7;

  const envelope = ctx.createGain();
  const start = ctx.currentTime + (options.delay ?? 0);
  const peak = options.gain ?? 0.008;
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(peak, start + 0.005);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(output ?? ctx.destination);
  source.start(start);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    envelope.disconnect();
  };
}

const players: Record<SoundName, (ctx: AudioContext) => void> = {
  tap: (ctx) => {
    tone(ctx, { frequency: 760, to: 620, duration: 0.055, gain: 0.022 });
    noise(ctx, { duration: 0.025, frequency: 2400, gain: 0.006 });
  },
  nav: (ctx) => {
    tone(ctx, { frequency: 392, to: 587.33, duration: 0.15, gain: 0.02, type: "triangle" });
    tone(ctx, { frequency: 783.99, duration: 0.18, delay: 0.035, gain: 0.01 });
  },
  copy: (ctx) => {
    tone(ctx, { frequency: 1046.5, duration: 0.13, gain: 0.014 });
    tone(ctx, { frequency: 1567.98, duration: 0.18, delay: 0.07, gain: 0.01 });
  },
  success: (ctx) => {
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      tone(ctx, { frequency, duration: 0.45, delay: index * 0.065, gain: 0.014 });
    });
    tone(ctx, { frequency: 1046.5, duration: 0.5, delay: 0.19, gain: 0.006 });
  },
  error: (ctx) => {
    tone(ctx, { frequency: 233.08, to: 174.61, duration: 0.2, gain: 0.028, type: "triangle" });
    tone(ctx, { frequency: 116.54, duration: 0.24, gain: 0.018 });
  },
  lock: (ctx) => {
    tone(ctx, { frequency: 523.25, to: 349.23, duration: 0.17, gain: 0.022, type: "triangle" });
    noise(ctx, { duration: 0.04, frequency: 900, gain: 0.009 });
  },
  step: (ctx) => {
    tone(ctx, { frequency: 587.33, duration: 0.09, gain: 0.012 });
    tone(ctx, { frequency: 880, duration: 0.14, delay: 0.07, gain: 0.009 });
  },
};

export function playSound(name: SoundName): void {
  if (!isSoundEnabled()) {
    return;
  }
  const ctx = getContext();
  if (!ctx) {
    return;
  }
  if (ctx.state === "suspended") {
    void ctx
      .resume()
      .then(() => {
        try {
          players[name](ctx);
        } catch {
          // Sound is decorative; a failed node must never break the interaction.
        }
      })
      .catch(() => undefined);
    return;
  }
  try {
    players[name](ctx);
  } catch {
    // Sound is decorative; a failed node must never break the interaction.
  }
}
