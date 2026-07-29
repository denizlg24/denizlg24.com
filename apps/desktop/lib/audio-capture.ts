/**
 * Everything the two microphone surfaces — saved voice notes and agent
 * dictation — need in common. They differ only in what they do with the blob
 * afterwards, so codec negotiation and level metering live here rather than
 * being kept in step by hand.
 */

export const RECORDING_BITS_PER_SECOND = 24_000;

/** Live meter width, in samples, for both surfaces. */
export const LEVEL_SAMPLE_LIMIT = 80;

/**
 * Ordered by preference, not availability: Opus in WebM is the smallest thing
 * every target accepts, and audio/mp4 is the Safari fallback.
 */
export function supportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return (
    candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
    ""
  );
}

export function extensionForMime(mimeType: string): string {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

/** The capture constraints both surfaces use; speech, not music. */
export const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  channelCount: 1,
};

export interface LevelMeter {
  /** Stop sampling and release the AudioContext. */
  stop(): void;
}

/**
 * Samples RMS loudness off the live stream on an interval and hands each
 * reading to `onLevel`. The scaling factor puts ordinary speech near the top of
 * the 0..1 range rather than leaving the meter flat.
 */
export function startLevelMeter(
  stream: MediaStream,
  onLevel: (level: number) => void,
  intervalMs = 100,
): LevelMeter {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  const timeDomain = new Uint8Array(analyser.fftSize);

  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(timeDomain);
    let sum = 0;
    for (const sample of timeDomain) {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    onLevel(Math.min(1, Math.sqrt(sum / timeDomain.length) * 3.5));
  }, intervalMs);

  return {
    stop() {
      clearInterval(timer);
      void audioContext.close();
    },
  };
}

/** Keeps a rolling window of the most recent readings at the shared cap. */
export function appendLevel(current: number[], level: number): number[] {
  return [...current.slice(-(LEVEL_SAMPLE_LIMIT - 1)), level];
}

/** Evenly reduces a full capture envelope to `count` stored samples. */
export function downsample(values: number[], count: number): number[] {
  if (values.length <= count) return values;
  const samples: number[] = [];
  const stride = values.length / count;
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor(index * stride);
    const end = Math.max(start + 1, Math.floor((index + 1) * stride));
    samples.push(Math.max(...values.slice(start, end)));
  }
  return samples;
}
