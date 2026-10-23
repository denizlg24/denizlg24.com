import { router } from "expo-router";

export function openTitle(id: string): void {
  router.push({ pathname: "/title/[id]", params: { id } });
}

export function playTitle(id: string, episode?: string | null): void {
  router.push({
    pathname: "/watch/[id]",
    params: episode ? { id, episode } : { id },
  });
}
