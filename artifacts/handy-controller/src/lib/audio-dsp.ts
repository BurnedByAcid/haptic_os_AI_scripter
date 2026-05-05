/**
 * Shared DSP utilities used by both the Audio Cleaner page and the Beat
 * Detector's inline Band Cleaner.  All functions accept the shared
 * AudioContext to avoid allocating extra contexts.
 */

export function applyVocalRemoval(buffer: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;

  if (numCh < 2) return buffer;

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const outBuffer = ctx.createBuffer(2, numSamples, buffer.sampleRate);
  const outL = outBuffer.getChannelData(0);
  const outR = outBuffer.getChannelData(1);

  for (let i = 0; i < numSamples; i++) {
    const side = (left[i] - right[i]) / 2;
    outL[i] = side;
    outR[i] = side;
  }

  return outBuffer;
}

/**
 * Linear-time rolling-RMS transient limiter.
 * Maintains a running sum-of-squares via a sliding window so each sample
 * is processed in O(1) rather than O(windowSize).
 */
export function applyImpactSuppression(
  buffer: AudioBuffer,
  ctx: AudioContext,
  windowSize = 512,
  ratio = 4,
): AudioBuffer {
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;
  const outBuffer = ctx.createBuffer(numCh, numSamples, buffer.sampleRate);

  for (let ch = 0; ch < numCh; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outBuffer.getChannelData(ch);

    const ring = new Float32Array(windowSize);
    let sumSq = 0;
    let ringIdx = 0;
    let filled = 0;

    for (let i = 0; i < numSamples; i++) {
      const outgoing = ring[ringIdx];
      sumSq -= outgoing * outgoing;

      const incoming = input[i];
      ring[ringIdx] = incoming;
      sumSq += incoming * incoming;
      ringIdx = (ringIdx + 1) % windowSize;
      if (filled < windowSize) filled++;

      const rms = Math.sqrt(sumSq / filled);
      const threshold = rms * ratio;
      if (threshold > 0 && Math.abs(incoming) > threshold) {
        output[i] = Math.sign(incoming) * threshold;
      } else {
        output[i] = incoming;
      }
    }
  }

  return outBuffer;
}

/**
 * First-order IIR low-pass at ~8 kHz followed by a peak hard-limiter.
 * Tames screaming by rolling off high-frequency content and capping peaks.
 */
export function applyScreamSuppression(buffer: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;
  const outBuffer = ctx.createBuffer(numCh, numSamples, buffer.sampleRate);

  const cutoffFreq = 8000;
  const RC = 1 / (2 * Math.PI * cutoffFreq);
  const dt = 1 / sampleRate;
  const alpha = dt / (RC + dt);
  const peakLimit = 0.6;

  for (let ch = 0; ch < numCh; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outBuffer.getChannelData(ch);

    let prev = 0;
    for (let i = 0; i < numSamples; i++) {
      prev = prev + alpha * (input[i] - prev);
      output[i] = Math.abs(prev) > peakLimit ? Math.sign(prev) * peakLimit : prev;
    }
  }

  return outBuffer;
}
