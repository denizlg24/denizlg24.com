/** Minimal public IFrame API surface; file playback never loads this script. */
export interface YoutubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  getPlayerState(): number;
  destroy(): void;
}
interface YoutubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      host: string;
      width: string;
      height: string;
      videoId: string;
      playerVars: Record<string, number | string>;
      events: {
        onReady(event: { target: YoutubePlayer }): void;
        onStateChange(): void;
        onError(): void;
        onAutoplayBlocked(): void;
      };
    },
  ) => YoutubePlayer;
}
declare global {
  interface Window {
    YT?: YoutubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let pending: Promise<YoutubeApi> | null = null;
export function loadYoutubeApi(): Promise<YoutubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<YoutubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    const timer = window.setTimeout(() => fail(), 20_000);
    function fail() {
      window.clearTimeout(timer);
      window.onYouTubeIframeAPIReady = previous;
      script.remove();
      pending = null;
      reject(new Error("YouTube could not load"));
    }
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timer);
      window.onYouTubeIframeAPIReady = previous;
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else fail();
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
  return pending;
}
