// Pure audio helpers for hold-to-talk: mic Float32 at the context's native rate in,
// PCM16 mono 16 kHz out (what Muse Voice Transcribe takes). No DOM, so it unit-tests.

export const TARGET_RATE = 16000;

/** Streaming box-filter downsampler. Handles non-integer ratios (44.1 kHz -> 16 kHz) across chunk boundaries. */
export class Downsampler {
  private ratio: number;
  private acc = 0;
  private binW = 0;

  constructor(inRate: number, outRate = TARGET_RATE) {
    this.ratio = inRate / outRate;
  }

  reset(): void {
    this.acc = 0;
    this.binW = 0;
  }

  process(input: Float32Array): Int16Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const s = input[i];
      let w = 1;
      while (w > 1e-9) {
        const take = Math.min(w, this.ratio - this.binW);
        this.acc += s * take;
        this.binW += take;
        w -= take;
        if (this.binW >= this.ratio - 1e-9) {
          out.push(floatToInt16(this.acc / this.binW));
          this.acc = 0;
          this.binW = 0;
        }
      }
    }
    return Int16Array.from(out);
  }
}

export function floatToInt16(f: number): number {
  const c = f < -1 ? -1 : f > 1 ? 1 : f;
  return c < 0 ? Math.round(c * 32768) : Math.round(c * 32767);
}

/** Root-mean-square level 0..1, for pulsing the orb with mic volume. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Map RMS to a 0..1 orb pulse; speech sits around 0.02-0.2 RMS. */
export function orbLevel(level: number): number {
  return Math.min(1, Math.sqrt(level * 6));
}
