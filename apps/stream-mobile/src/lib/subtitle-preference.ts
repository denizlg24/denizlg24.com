import {
  type SubtitlePreference,
  subtitlePreferenceSchema,
} from "@repo/schemas/stream";
import * as SecureStore from "expo-secure-store";
import { createStore, useStore } from "./store";

const KEY = "stream.subtitles";

/**
 * This device's last subtitle choice, kept for the next film; `undefined`
 * until read. A TV is shared, so it belongs to the screen, not a profile.
 */
const preference = createStore<SubtitlePreference | undefined>(undefined);

export async function loadSubtitlePreference(): Promise<void> {
  const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
  const parsed = subtitlePreferenceSchema.safeParse(raw);
  preference.set(parsed.success ? parsed.data : "auto");
}

export function setSubtitlePreference(value: SubtitlePreference): void {
  preference.set(value);
  void SecureStore.setItemAsync(KEY, value).catch(() => undefined);
}

export function useSubtitlePreference(): SubtitlePreference | undefined {
  return useStore(preference);
}
