import type { Profile, ProfileLayout } from "@repo/schemas/stream";
import * as SecureStore from "expo-secure-store";
import { createContext, use } from "react";
import { z } from "zod";
import { createStore, useStore } from "./store";

const KEY = "stream.audience";

/** The sofa's last choice on this device; `undefined` until read from storage. */
export const audienceIds = createStore<string[] | null | undefined>(undefined);

export async function loadAudience(): Promise<void> {
  const raw = await SecureStore.getItemAsync(KEY).catch(() => null);
  let stored: string[] | null = null;
  if (raw) {
    try {
      const parsed = z.array(z.string()).safeParse(JSON.parse(raw));
      stored = parsed.success ? parsed.data : null;
    } catch {
      stored = null;
    }
  }
  audienceIds.set(stored);
}

export function seatAudience(ids: string[] | null): void {
  audienceIds.set(ids);
  void (
    ids && ids.length > 0
      ? SecureStore.setItemAsync(KEY, JSON.stringify(ids))
      : SecureStore.deleteItemAsync(KEY)
  ).catch(() => undefined);
}

export function useAudienceIds(): string[] | null | undefined {
  return useStore(audienceIds);
}

export interface Audience {
  audience: Profile[];
  /** The first on the sofa: its layout is the app's; profile-scoped routes use it. */
  lead: Profile;
  layout: ProfileLayout;
  /** `a,b` for `?profiles=`. */
  key: string;
}

export const AudienceContext = createContext<Audience | null>(null);

/** Only screens behind the sofa may call this. */
export function useAudience(): Audience {
  const value = use(AudienceContext);
  if (!value) throw new Error("useAudience outside the sofa gate");
  return value;
}
