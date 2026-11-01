"use client";

import {
  type Appearance,
  type AppearancePatch,
  activeThemeId,
  appearanceResponseSchema,
  appearanceSchema,
  BUILTIN_THEMES,
  DEFAULT_APPEARANCE,
  DEFAULT_THEME_ID,
  type Theme,
  type ThemeInput,
  type ThemePatch,
  type ThemeScheduleInput,
  themeSchema,
} from "@repo/schemas";
import { z } from "zod";
import { create } from "zustand";
import type { AdminClient } from "../../client";

const ROOT = "workspace";
const CACHE_KEY = "denizlg24.appearance.v1";
const cacheSchema = z.object({
  appearance: appearanceSchema,
  themes: z.array(themeSchema),
});

interface AppearanceState {
  appearance: Appearance;
  themes: Theme[];
  loaded: boolean;
  /** A theme the open page wears instead of the app's. */
  pageThemeId: string | null;
  /** An unsaved theme the editor is showing. */
  preview: Theme | null;
  load: (client: AdminClient) => Promise<void>;
  setPageTheme: (id: string | null) => void;
  setPreview: (theme: Theme | null) => void;
  patch: (patch: AppearancePatch) => Promise<void>;
  createTheme: (input: ThemeInput) => Promise<Theme | null>;
  updateTheme: (id: string, patch: ThemePatch) => Promise<Theme | null>;
  deleteTheme: (id: string) => Promise<void>;
  addSchedule: (input: ThemeScheduleInput) => Promise<void>;
  removeSchedule: (id: string) => Promise<void>;
}

let api: AdminClient | null = null;

function readCache(): z.infer<typeof cacheSchema> | null {
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = cacheSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeCache(value: z.infer<typeof cacheSchema>) {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(value));
  } catch {
    // A full or blocked store only costs an instant first paint.
  }
}

const cached = readCache();

const appearanceOnly = z.object({ appearance: appearanceSchema });
const themeOnly = z.object({ theme: themeSchema });

export const useAppearanceStore = create<AppearanceState>((set, get) => {
  const remember = (next: Partial<AppearanceState>) => {
    set(next);
    const { appearance, themes } = get();
    writeCache({ appearance, themes });
  };
  const fail = (what: string) => (error: unknown) => {
    console.error(`Failed to ${what}:`, error);
  };
  const reload = async () => {
    if (!api) return;
    const parsed = appearanceResponseSchema.parse(
      await api.get(`${ROOT}/appearance`),
    );
    remember({ ...parsed, loaded: true });
  };

  return {
    appearance: cached?.appearance ?? DEFAULT_APPEARANCE,
    themes: cached?.themes ?? BUILTIN_THEMES,
    loaded: false,
    pageThemeId: null,
    preview: null,

    load: async (client) => {
      api = client;
      await reload().catch(fail("load appearance"));
    },
    setPageTheme: (pageThemeId) => set({ pageThemeId }),
    setPreview: (preview) => set({ preview }),

    patch: async (patch) => {
      if (!api) return;
      const previous = get().appearance;
      set({ appearance: { ...previous, ...patch } });
      try {
        const { appearance } = appearanceOnly.parse(
          await api.patch(`${ROOT}/appearance`, patch),
        );
        remember({ appearance });
      } catch (error) {
        set({ appearance: previous });
        fail("save appearance")(error);
      }
    },

    createTheme: async (input) => {
      if (!api) return null;
      try {
        const { theme } = themeOnly.parse(
          await api.post(`${ROOT}/themes`, input),
        );
        remember({ themes: [...get().themes, theme] });
        return theme;
      } catch (error) {
        fail("create theme")(error);
        return null;
      }
    },

    updateTheme: async (id, patch) => {
      if (!api) return null;
      try {
        const { theme } = themeOnly.parse(
          await api.patch(`${ROOT}/themes/${encodeURIComponent(id)}`, patch),
        );
        remember({
          themes: get().themes.map((t) => (t.id === id ? theme : t)),
        });
        return theme;
      } catch (error) {
        fail("save theme")(error);
        return null;
      }
    },

    deleteTheme: async (id) => {
      if (!api) return;
      try {
        await api.del(`${ROOT}/themes/${encodeURIComponent(id)}`);
        await reload();
      } catch (error) {
        fail("delete theme")(error);
      }
    },

    addSchedule: async (input) => {
      if (!api) return;
      try {
        const { appearance } = appearanceOnly.parse(
          await api.post(`${ROOT}/appearance/schedule`, input),
        );
        remember({ appearance });
      } catch (error) {
        fail("schedule theme")(error);
      }
    },

    removeSchedule: async (id) => {
      if (!api) return;
      try {
        const { appearance } = appearanceOnly.parse(
          await api.del(
            `${ROOT}/appearance/schedule/${encodeURIComponent(id)}`,
          ),
        );
        remember({ appearance });
      } catch (error) {
        fail("remove schedule entry")(error);
      }
    },
  };
});

export function localDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function findTheme(themes: Theme[], id: string): Theme {
  return (
    themes.find((t) => t.id === id) ??
    themes.find((t) => t.id === DEFAULT_THEME_ID) ??
    BUILTIN_THEMES[0]
  );
}

/** What is on right now: an editor preview, the page's own theme, else the schedule's or the default. */
export function useActiveTheme(): Theme {
  const preview = useAppearanceStore((s) => s.preview);
  const pageThemeId = useAppearanceStore((s) => s.pageThemeId);
  const themes = useAppearanceStore((s) => s.themes);
  const appearance = useAppearanceStore((s) => s.appearance);
  if (preview) return preview;
  return findTheme(
    themes,
    pageThemeId ?? activeThemeId(appearance, localDay()),
  );
}
