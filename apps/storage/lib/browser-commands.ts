"use client";

import { useEffect } from "react";

export type BrowserCommand =
  | "new-folder"
  | "upload-files"
  | "upload-folder"
  | "upload-photos"
  | "take-photo";

type Listener = (command: BrowserCommand) => void;

const listeners = new Set<Listener>();

/**
 * The shell's Upload button and the phone's `+` sheet live outside the folder
 * page but act on it. Rather than threading callbacks through layouts, the
 * page listens and the shell emits; a command with no listener (no folder
 * open) is dropped, and the shell disables the button in that case anyway.
 */
export const browserCommands = {
  emit(command: BrowserCommand): boolean {
    for (const listener of listeners) listener(command);
    return listeners.size > 0;
  },
  get hasListener(): boolean {
    return listeners.size > 0;
  },
};

export function useBrowserCommands(listener: Listener): void {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}
