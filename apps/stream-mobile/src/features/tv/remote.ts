import { useEffect, useRef } from "react";
import { DeviceEventEmitter } from "react-native";

const REMOTE_KEYS = [
  "select",
  "play",
  "pause",
  "playPause",
  "rewind",
  "fastForward",
  "stop",
  "next",
  "previous",
  "up",
  "down",
  "left",
  "right",
  "info",
  "menu",
] as const;

export type RemoteKey = (typeof REMOTE_KEYS)[number];

const known = new Set<string>(REMOTE_KEYS);

interface HardwareKeyEvent {
  eventType: string;
  /** `KeyEvent.ACTION_DOWN` is 0, `ACTION_UP` 1; focus and blur carry -1. */
  eventKeyAction: number;
}

function isRemoteKey(value: string): value is RemoteKey {
  return known.has(value);
}

/**
 * Key-down presses on the remote, wherever focus is. React Native's root view
 * emits every D-pad and media key as `onHWKeyEvent`, so this needs no fork of
 * React Native. A held key repeats. Back is not among them: that is
 * `BackHandler`.
 */
export function useRemote(
  handler: (key: RemoteKey) => void,
  enabled = true,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const subscription = DeviceEventEmitter.addListener(
      "onHWKeyEvent",
      (event: HardwareKeyEvent) => {
        if (event.eventKeyAction !== 0) return;
        if (isRemoteKey(event.eventType)) latest.current(event.eventType);
      },
    );
    return () => subscription.remove();
  }, [enabled]);
}
