/**
 * Browser APIs TypeScript's DOM lib does not describe: `audioTracks`
 * (Safari, flagged elsewhere) and WebKit's fullscreen and AirPlay methods.
 */

export interface AudioTrackLike {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}

export interface AudioTrackListLike extends EventTarget {
  readonly length: number;
  [index: number]: AudioTrackLike;
}

function isAudioTrackList(value: unknown): value is AudioTrackListLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "length" in value &&
    typeof value.length === "number" &&
    "addEventListener" in value
  );
}

export function audioTracksOf(
  video: HTMLVideoElement,
): AudioTrackListLike | null {
  const list: unknown = Reflect.get(video, "audioTracks");
  return isAudioTrackList(list) ? list : null;
}

function method(target: object, name: string): (() => unknown) | null {
  const fn: unknown = Reflect.get(target, name);
  return typeof fn === "function" ? () => fn.call(target) : null;
}

export function webkitEnterFullscreen(video: HTMLVideoElement) {
  return method(video, "webkitEnterFullscreen");
}

export function webkitRequestFullscreen(element: HTMLElement) {
  return method(element, "webkitRequestFullscreen");
}

export function webkitExitFullscreen() {
  return method(document, "webkitExitFullscreen");
}

export function fullscreenElement(): Element | null {
  const webkit: unknown = Reflect.get(document, "webkitFullscreenElement");
  return (
    document.fullscreenElement ?? (webkit instanceof Element ? webkit : null)
  );
}

export function fullscreenSupported(): boolean {
  return (
    document.fullscreenEnabled ||
    Reflect.get(document, "webkitFullscreenEnabled") === true
  );
}

export function airPlaySupported(): boolean {
  return "WebKitPlaybackTargetAvailabilityEvent" in window;
}

export function showAirPlayPicker(video: HTMLVideoElement) {
  return method(video, "webkitShowPlaybackTargetPicker");
}

export function playbackTargetAvailable(event: Event): boolean {
  return Reflect.get(event, "availability") === "available";
}
