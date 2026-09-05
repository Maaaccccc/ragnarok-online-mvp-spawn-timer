// Web Audio API Sound Synthesizer for RO MVP Spawn Alerts

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play authentic RO Spawn Fanfare chime
 */
export function playSpawnSound(volume = 0.8) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(volume, now);
    masterGain.connect(ctx.destination);

    // Notes for triumphant RO Spawn Fanfare: C5, E5, G5, C6
    const notes = [
      { freq: 523.25, time: 0, duration: 0.18, type: 'triangle' },
      { freq: 659.25, time: 0.15, duration: 0.18, type: 'triangle' },
      { freq: 783.99, time: 0.30, duration: 0.22, type: 'triangle' },
      { freq: 1046.50, time: 0.48, duration: 0.80, type: 'sine' }
    ];

    notes.forEach(({ freq, time, duration, type }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + time);

      // Envelope
      gain.gain.setValueAtTime(0, now + time);
      gain.gain.linearRampToValueAtTime(0.6, now + time + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + time + duration);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(now + time);
      osc.stop(now + time + duration);
    });

    // Add brassy sub-chord
    const bassOsc = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bassOsc.type = 'sawtooth';
    bassOsc.frequency.setValueAtTime(261.63, now + 0.48); // C4
    bassGain.gain.setValueAtTime(0.3, now + 0.48);
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    bassOsc.connect(bassGain);
    bassGain.connect(masterGain);

    bassOsc.start(now + 0.48);
    bassOsc.stop(now + 1.2);

  } catch (err) {
    console.warn("Could not play spawn sound:", err);
  }
}

/**
 * Play subtle 5-minute warning beep
 */
export function playWarningSound(volume = 0.5) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.setValueAtTime(1760, now + 0.1); // A6

    gain.gain.setValueAtTime(0.3 * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {
    console.warn("Could not play warning sound:", e);
  }
}
