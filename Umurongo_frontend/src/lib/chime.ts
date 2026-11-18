// Two-tone chime with the Web Audio API (no sound file to download).
// Browsers only allow sound after a tap or click, so unlock() must run inside a click handler.

let ctx: AudioContext | null = null;

export function audioSupported(): boolean {
  return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
}

/** Creates or resumes the audio context. Call from a click handler. Returns false if sound is not possible. */
export async function unlockAudio(): Promise<boolean> {
  if (!audioSupported()) return false;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') await ctx.resume();
    return ctx.state === 'running';
  } catch {
    return false;
  }
}

/** Plays "ding-dong": a high then a lower tone. */
export function chime(volume = 0.25) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [
    { freq: 880, at: 0 },
    { freq: 660, at: 0.38 },
  ].forEach(({ freq, at }) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + at);
    gain.gain.linearRampToValueAtTime(volume, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.9);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.95);
  });
}

/** Vibrates where supported (most Android phones; not iPhone). */
export function vibrate(pattern: number[] = [400, 150, 400, 150, 600]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported: the chime and the screen still alert the patient.
  }
}
