/* global AudioWorkletProcessor, registerProcessor, sampleRate */
class PttCaptureProcessor extends AudioWorkletProcessor {
  sum = 0;
  index = 0;
  finished = false;

  constructor(options) {
    super();
    const highQuality = options?.processorOptions?.sampleRate === 24000;
    this.frameSamples = highQuality ? 480 : 640;
    this.ratio = sampleRate / (highQuality ? 24000 : 16000);
    this.remaining = this.ratio;
    this.frame = new DataView(new ArrayBuffer(this.frameSamples * 2));
    this.port.onmessage = ({ data }) => {
      if (data !== 'flush' || this.finished) return;
      this.finished = true;
      const partial = this.ratio - this.remaining;
      if (partial > 1e-6) this.writeSample(this.sum / partial);
      // The unused portion of the last PCM frame is already padded with silence.
      if (this.index > 0) this.sendFrame();
      this.port.postMessage('drained');
    };
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (this.finished || !samples) return true;
    for (const sample of samples) {
      // Average each output sample over its share of the original input.
      let weight = 1;
      while (weight >= this.remaining) {
        this.sum += sample * this.remaining;
        this.writeSample(this.sum / this.ratio);
        weight -= this.remaining;
        this.remaining = this.ratio;
        this.sum = 0;
      }
      this.sum += sample * weight;
      this.remaining -= weight;
    }
    return true;
  }

  writeSample(value) {
    this.frame.setInt16(this.index * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true);
    this.index++;
    if (this.index === this.frameSamples) this.sendFrame();
  }

  sendFrame() {
    const bytes = this.frame.buffer;
    this.port.postMessage(bytes, [bytes]);
    this.frame = new DataView(new ArrayBuffer(this.frameSamples * 2));
    this.index = 0;
  }
}

registerProcessor('edu-ptt-capture', PttCaptureProcessor);
