/**
 * Shared DSP utilities used by both the Audio Cleaner page and the Beat
 * Detector's inline Band Cleaner.  All functions accept the shared
 * AudioContext to avoid allocating extra contexts.
 */

/**
 * Phase-cancellation vocal removal with adjustable blend strength.
 * strength = 0 → passthrough, strength = 1 → full vocal removal (default).
 */
export function applyVocalRemoval(
  buffer: AudioBuffer,
  ctx: AudioContext,
  strength = 1,
): AudioBuffer {
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;

  if (numCh < 2) return buffer;

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const outBuffer = ctx.createBuffer(2, numSamples, buffer.sampleRate);
  const outL = outBuffer.getChannelData(0);
  const outR = outBuffer.getChannelData(1);

  const blend = Math.max(0, Math.min(1, strength));

  for (let i = 0; i < numSamples; i++) {
    const side = (left[i] - right[i]) / 2;
    outL[i] = side * blend + left[i] * (1 - blend);
    outR[i] = side * blend + right[i] * (1 - blend);
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
 * First-order IIR low-pass followed by a peak hard-limiter.
 * Tames screaming by rolling off high-frequency content and capping peaks.
 *
 * cutoffHz  — low-pass cutoff frequency in Hz (default 8000)
 * peakLimit — hard clip ceiling 0–1 (default 0.6)
 */
export function applyScreamSuppression(
  buffer: AudioBuffer,
  ctx: AudioContext,
  cutoffHz = 8000,
  peakLimit = 0.6,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;
  const outBuffer = ctx.createBuffer(numCh, numSamples, buffer.sampleRate);

  const RC = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const alpha = dt / (RC + dt);
  const limit = Math.max(0.01, Math.min(1, peakLimit));

  for (let ch = 0; ch < numCh; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outBuffer.getChannelData(ch);

    let prev = 0;
    for (let i = 0; i < numSamples; i++) {
      prev = prev + alpha * (input[i] - prev);
      output[i] = Math.abs(prev) > limit ? Math.sign(prev) * limit : prev;
    }
  }

  return outBuffer;
}
