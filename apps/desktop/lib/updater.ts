import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "./platform";

/**
 * Checks the release endpoint for a newer build. Returns the pending
 * update, or null when already on the latest version or outside Tauri.
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;

  const { check } = await import("@tauri-apps/plugin-updater");
  return await check();
}
