const REPLAY_FRAMES = 400;
export const MAX_BATCH_FRAMES = 10;
export const REPLAY_TTL_MS = 12_000;

type Chunk = { firstFrame: number; audio: Buffer };

export class PttStreamBuffer {
  private chunks: Chunk[] = [];
  nextFrame = 0;

  constructor(readonly frameBytes: number) {}

  append(audio: Buffer) {
    this.chunks.push({ firstFrame: this.nextFrame, audio });
    this.nextFrame += audio.length / this.frameBytes;
    const oldest = this.nextFrame - REPLAY_FRAMES;
    while (this.chunks.length && this.chunks[0].firstFrame + this.chunks[0].audio.length / this.frameBytes <= oldest) {
      this.chunks.shift();
    }
  }

  read(fromFrame: number) {
    if (!this.chunks.length || fromFrame >= this.nextFrame) return undefined;
    const firstFrame = Math.max(fromFrame, this.chunks[0].firstFrame);
    const parts = this.chunks.flatMap((chunk) => {
      const offset = Math.max(0, firstFrame - chunk.firstFrame) * this.frameBytes;
      return offset < chunk.audio.length ? [chunk.audio.subarray(offset)] : [];
    });
    return { firstFrame, audio: Buffer.concat(parts) };
  }
}
