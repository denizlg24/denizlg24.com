"use client";

import type { ReactIconSet } from "@repo/schemas";
import { useEffect } from "react";
import type { IconType } from "react-icons";
import { create } from "zustand";

type IconModule = Record<string, IconType>;

/** One chunk per set: written out so the bundler can split each import. */
const LOADERS: Record<ReactIconSet, () => Promise<object>> = {
  fa6: () => import("react-icons/fa6"),
  md: () => import("react-icons/md"),
  pi: () => import("react-icons/pi"),
  tb: () => import("react-icons/tb"),
  si: () => import("react-icons/si"),
  gi: () => import("react-icons/gi"),
  bi: () => import("react-icons/bi"),
  hi2: () => import("react-icons/hi2"),
  io5: () => import("react-icons/io5"),
  ri: () => import("react-icons/ri"),
  fi: () => import("react-icons/fi"),
  bs: () => import("react-icons/bs"),
  vsc: () => import("react-icons/vsc"),
  wi: () => import("react-icons/wi"),
};

export const REACT_ICON_SET_LABELS: Record<ReactIconSet, string> = {
  si: "Brands",
  fa6: "Font Awesome",
  md: "Material",
  pi: "Phosphor",
  tb: "Tabler",
  gi: "Game",
  bi: "BoxIcons",
  hi2: "Heroicons",
  io5: "Ionicons",
  ri: "Remix",
  fi: "Feather",
  bs: "Bootstrap",
  vsc: "VS Code",
  wi: "Weather",
};

interface ReactIconSetsState {
  sets: Partial<Record<ReactIconSet, IconModule>>;
  load: (set: ReactIconSet) => void;
}

const loading = new Set<ReactIconSet>();

function isIconType(value: unknown): value is IconType {
  return typeof value === "function";
}

const useReactIconSets = create<ReactIconSetsState>((set, get) => ({
  sets: {},
  load: (name) => {
    if (get().sets[name] || loading.has(name)) return;
    loading.add(name);
    LOADERS[name]()
      .then((module) => {
        const icons: IconModule = {};
        for (const [key, value] of Object.entries(module)) {
          if (key !== "default" && isIconType(value)) icons[key] = value;
        }
        set({ sets: { ...get().sets, [name]: icons } });
      })
      .catch((error: unknown) =>
        console.error(`Failed to load icon set ${name}:`, error),
      )
      .finally(() => loading.delete(name));
  },
}));

/** A set's icons, or null while its chunk loads. */
export function useReactIconSet(set: ReactIconSet | null): IconModule | null {
  const icons = useReactIconSets((s) => (set ? s.sets[set] : undefined));
  const load = useReactIconSets((s) => s.load);
  useEffect(() => {
    if (set) load(set);
  }, [set, load]);
  return icons ?? null;
}
