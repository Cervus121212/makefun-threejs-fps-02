// All sound is synthesised with WebAudio: no audio files, no network, nothing to load.
// Each effect is a short node graph built on demand and thrown away when it ends.
export function createAudio() {
  let ctx = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      return false;
    }
    return true;
  }

  function noiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration, type = 'lowpass', freq = 1200, gain = 0.5, at = 0 }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(duration);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    src.connect(filter).connect(amp).connect(master);
    src.start(t0);
    src.stop(t0 + duration);
  }

  function tone({ freq = 440, to = null, duration = 0.1, type = 'square', gain = 0.2, at = 0 }) {
    if (!ensure() || muted) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t0);
    amp.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(amp).connect(master);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  return {
    unlock() {
      ensure();
    },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(kind) {
      if (kind === 'sniper') {
        burst({ duration: 0.28, freq: 900, gain: 0.9 });
        tone({ freq: 160, to: 55, duration: 0.22, type: 'sawtooth', gain: 0.35 });
      } else if (kind === 'shotgun') {
        burst({ duration: 0.22, freq: 700, gain: 0.85 });
        tone({ freq: 120, to: 45, duration: 0.18, type: 'sawtooth', gain: 0.3 });
      } else if (kind === 'smg') {
        burst({ duration: 0.09, freq: 1800, gain: 0.42 });
      } else if (kind === 'pistol') {
        burst({ duration: 0.12, freq: 1400, gain: 0.55 });
        tone({ freq: 220, to: 90, duration: 0.08, type: 'square', gain: 0.15 });
      } else {
        burst({ duration: 0.14, freq: 1100, gain: 0.7 });
        tone({ freq: 180, to: 70, duration: 0.12, type: 'sawtooth', gain: 0.25 });
      }
    },
    distantShot() {
      burst({ duration: 0.16, freq: 500, gain: 0.16 });
    },
    dryFire() {
      tone({ freq: 900, duration: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ freq: 500, duration: 0.04, type: 'square', gain: 0.12, at: 0 });
      tone({ freq: 320, duration: 0.04, type: 'square', gain: 0.12, at: 0.35 });
      tone({ freq: 640, duration: 0.05, type: 'square', gain: 0.14, at: 0.7 });
    },
    hit() {
      tone({ freq: 1400, duration: 0.05, type: 'sine', gain: 0.22 });
    },
    kill() {
      tone({ freq: 1400, duration: 0.05, type: 'sine', gain: 0.22 });
      tone({ freq: 1900, duration: 0.07, type: 'sine', gain: 0.2, at: 0.06 });
    },
    hurt() {
      tone({ freq: 140, to: 70, duration: 0.18, type: 'sawtooth', gain: 0.25 });
    },
    beep(final = false) {
      tone({ freq: final ? 1760 : 1180, duration: 0.09, type: 'sine', gain: 0.25 });
    },
    plantDone() {
      tone({ freq: 880, duration: 0.12, type: 'sine', gain: 0.25 });
      tone({ freq: 1320, duration: 0.16, type: 'sine', gain: 0.25, at: 0.12 });
    },
    explosion() {
      burst({ duration: 1.1, freq: 320, gain: 1.0 });
      tone({ freq: 90, to: 28, duration: 0.9, type: 'sine', gain: 0.6 });
      burst({ duration: 0.4, freq: 2400, gain: 0.3 });
    },
    grenadePin() {
      tone({ freq: 2400, duration: 0.03, type: 'square', gain: 0.1 });
    },
    buy() {
      tone({ freq: 660, duration: 0.06, type: 'sine', gain: 0.2 });
      tone({ freq: 990, duration: 0.08, type: 'sine', gain: 0.2, at: 0.06 });
    },
    denied() {
      tone({ freq: 220, duration: 0.12, type: 'square', gain: 0.16 });
    },
    roundWin() {
      tone({ freq: 523, duration: 0.14, type: 'triangle', gain: 0.25 });
      tone({ freq: 659, duration: 0.14, type: 'triangle', gain: 0.25, at: 0.13 });
      tone({ freq: 784, duration: 0.22, type: 'triangle', gain: 0.28, at: 0.26 });
    },
    roundLose() {
      tone({ freq: 392, duration: 0.16, type: 'triangle', gain: 0.22 });
      tone({ freq: 311, duration: 0.16, type: 'triangle', gain: 0.22, at: 0.15 });
      tone({ freq: 233, duration: 0.28, type: 'triangle', gain: 0.24, at: 0.3 });
    },
  };
}
