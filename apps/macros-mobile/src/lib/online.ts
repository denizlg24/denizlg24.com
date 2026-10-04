import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/**
 * Whether React Query believes the phone is online. A mutation's `isPaused`
 * alone does not mean offline: one queued behind another in the same scope
 * is paused too, so "will sync when you're back online" checks this as well.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => onlineManager.subscribe(notify),
    () => onlineManager.isOnline(),
  );
}
