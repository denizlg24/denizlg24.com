/**
 * What the player chrome drives. The live one wraps an expo-video player
 * (`use-video-controller.ts`); `UNAVAILABLE` is the same chrome with nothing
 * to play, which is every title today.
 */
export interface SubtitleOption {
  id: string;
  label: string;
}

export interface PlayerController {
  available: boolean;
  playing: boolean;
  buffering: boolean;
  /** Seconds. */
  position: number;
  /** Seconds; 0 until known. */
  duration: number;
  rate: number;
  subtitles: SubtitleOption[];
  subtitle: string | null;
  pictureInPicture: boolean;
  toggle(): void;
  seekBy(seconds: number): void;
  seekTo(seconds: number): void;
  setRate(rate: number): void;
  setSubtitle(id: string | null): void;
  startPictureInPicture(): void;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const SKIP_SECONDS = 10;

const noop = () => undefined;

export const UNAVAILABLE: PlayerController = {
  available: false,
  playing: false,
  buffering: false,
  position: 0,
  duration: 0,
  rate: 1,
  subtitles: [],
  subtitle: null,
  pictureInPicture: false,
  toggle: noop,
  seekBy: noop,
  seekTo: noop,
  setRate: noop,
  setSubtitle: noop,
  startPictureInPicture: noop,
};

export function rateLabel(rate: number): string {
  return rate === 1 ? "Normal" : `${rate}x`;
}

/** Keeps a seek inside the runtime; an unknown duration only floors at zero. */
export function clampSeek(target: number, duration: number): number {
  const floored = Math.max(0, target);
  return duration > 0 ? Math.min(floored, duration) : floored;
}
