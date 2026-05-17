/** Plays OpenAI TTS PCM output: mono, 16-bit signed LE, 24 kHz. */

const PCM_SAMPLE_RATE = 24_000;

export class PcmStreamPlayback {
  private readonly ctx: AudioContext;
  private nextTime = 0;
  private pending = new Uint8Array(0);

  constructor() {
    this.ctx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
  }

  async ensureRunning(): Promise<void> {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  append(chunk: Uint8Array): void {
    const merged = new Uint8Array(this.pending.length + chunk.length);
    merged.set(this.pending);
    merged.set(chunk, this.pending.length);
    const evenLen = merged.length - (merged.length % 2);
    this.pending = merged.slice(evenLen);
    if (evenLen < 2) {
      return;
    }
    const pcmBytes = merged.subarray(0, evenLen);
    const samples = new Int16Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      pcmBytes.byteLength / 2
    );
    this.schedule(samples);
  }

  /** Flush any trailing odd byte (incomplete sample). */
  finish(): void {
    this.pending = new Uint8Array(0);
  }

  async stop(): Promise<void> {
    try {
      await this.ctx.close();
    } catch {
      // Already closed
    }
  }

  private schedule(samples: Int16Array): void {
    const buf = this.ctx.createBuffer(1, samples.length, PCM_SAMPLE_RATE);
    const channel = buf.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i] ?? 0;
      channel[i] = sample / 32_768;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.connect(this.ctx.destination);
    const startAt = Math.max(this.ctx.currentTime, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buf.duration;
  }
}
