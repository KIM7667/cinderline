// All sound is synthesised with WebAudio — no audio files ship with the game.
// Short noise bursts and shaped oscillators cover gunfire, impacts and the
// charge's beeper; every voice is a few nodes created on the spot and dropped.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return true;
  }

  function noiseBuffer(seconds) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ seconds = 0.12, type = 'lowpass', freq = 1200, q = 0.8, gain = 0.7, slide = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(seconds);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (slide) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + seconds);
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(filter).connect(amp).connect(master);
    src.start(t);
    src.stop(t + seconds + 0.02);
  }

  function tone({ freq = 440, seconds = 0.1, type = 'square', gain = 0.2, slide = 0, delay = 0 }) {
    if (!ensure()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + seconds);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  return {
    unlock() {
      ensure();
    },
    // Gunfire voices: heavier bodies for the rifle and shotgun, a crack for the DMR.
    shot(kind) {
      if (kind === 'shotgun') {
        burst({ seconds: 0.28, freq: 900, gain: 0.9, slide: -500 });
        tone({ freq: 120, seconds: 0.2, type: 'triangle', gain: 0.5, slide: -60 });
      } else if (kind === 'dmr') {
        burst({ seconds: 0.2, freq: 2600, gain: 0.8, slide: -1800 });
        tone({ freq: 180, seconds: 0.16, type: 'triangle', gain: 0.45, slide: -90 });
      } else if (kind === 'smg') {
        burst({ seconds: 0.09, freq: 1900, gain: 0.55, slide: -700 });
      } else if (kind === 'pistol') {
        burst({ seconds: 0.11, freq: 1700, gain: 0.6, slide: -800 });
      } else {
        burst({ seconds: 0.14, freq: 1400, gain: 0.7, slide: -800 });
        tone({ freq: 150, seconds: 0.1, type: 'triangle', gain: 0.35, slide: -70 });
      }
    },
    dryFire() {
      tone({ freq: 1400, seconds: 0.03, type: 'square', gain: 0.12 });
    },
    reload() {
      tone({ freq: 700, seconds: 0.05, type: 'square', gain: 0.15 });
      tone({ freq: 420, seconds: 0.05, type: 'square', gain: 0.15, delay: 0.22 });
      tone({ freq: 950, seconds: 0.05, type: 'square', gain: 0.18, delay: 0.5 });
    },
    hit(head) {
      tone({ freq: head ? 1560 : 1180, seconds: 0.06, type: 'sine', gain: 0.25 });
    },
    kill() {
      tone({ freq: 880, seconds: 0.09, type: 'sine', gain: 0.22 });
      tone({ freq: 1320, seconds: 0.12, type: 'sine', gain: 0.22, delay: 0.07 });
    },
    hurt() {
      burst({ seconds: 0.1, freq: 500, gain: 0.4 });
    },
    throwWhoosh() {
      burst({ seconds: 0.18, type: 'bandpass', freq: 900, q: 2, gain: 0.25, slide: 900 });
    },
    frag() {
      burst({ seconds: 0.7, freq: 700, gain: 1.0, slide: -550 });
      tone({ freq: 90, seconds: 0.6, type: 'sine', gain: 0.8, slide: -50 });
    },
    flash() {
      tone({ freq: 3400, seconds: 0.35, type: 'sine', gain: 0.3, slide: -2600 });
      burst({ seconds: 0.2, type: 'highpass', freq: 3000, gain: 0.3 });
    },
    smoke() {
      burst({ seconds: 0.5, type: 'bandpass', freq: 600, q: 1, gain: 0.3 });
    },
    beep(final) {
      tone({ freq: final ? 1760 : 1174, seconds: final ? 0.2 : 0.07, type: 'square', gain: 0.16 });
    },
    plantDone() {
      tone({ freq: 1046, seconds: 0.09, type: 'square', gain: 0.18 });
      tone({ freq: 1568, seconds: 0.14, type: 'square', gain: 0.18, delay: 0.1 });
    },
    roundWin() {
      tone({ freq: 523, seconds: 0.12, type: 'triangle', gain: 0.3 });
      tone({ freq: 659, seconds: 0.12, type: 'triangle', gain: 0.3, delay: 0.11 });
      tone({ freq: 784, seconds: 0.22, type: 'triangle', gain: 0.32, delay: 0.22 });
    },
    roundLose() {
      tone({ freq: 392, seconds: 0.14, type: 'triangle', gain: 0.3 });
      tone({ freq: 330, seconds: 0.14, type: 'triangle', gain: 0.3, delay: 0.12 });
      tone({ freq: 262, seconds: 0.26, type: 'triangle', gain: 0.3, delay: 0.24 });
    },
    buy() {
      tone({ freq: 1568, seconds: 0.06, type: 'sine', gain: 0.2 });
      tone({ freq: 2093, seconds: 0.09, type: 'sine', gain: 0.2, delay: 0.05 });
    },
    denied() {
      tone({ freq: 220, seconds: 0.12, type: 'square', gain: 0.15 });
    },
  };
}
