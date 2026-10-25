import { router } from "expo-router";
import { Keyboard } from "react-native";

// The TV keyboard Search opened would otherwise stay up over the next screen.
export function openTvTitle(id: string): void {
  Keyboard.dismiss();
  router.push({ pathname: "/tv/title/[id]", params: { id } });
}

export function playOnTv(id: string, episode?: string | null): void {
  Keyboard.dismiss();
  router.push({
    pathname: "/tv/watch/[id]",
    params: episode ? { id, episode } : { id },
  });
}
