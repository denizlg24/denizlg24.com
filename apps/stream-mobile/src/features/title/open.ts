import { router } from "expo-router";
import { Linking } from "react-native";

export function openTitle(id: string): void {
  router.push({ pathname: "/title/[id]", params: { id } });
}

export function playTitle(id: string, episode?: string | null): void {
  router.push({
    pathname: "/watch/[id]",
    params: episode ? { id, episode } : { id },
  });
}

/** A poster grid of `GET /titles` under a heading: a row's "more", a genre, a theme. */
export function openGrid(label: string, params: Record<string, string>): void {
  router.push({ pathname: "/browse", params: { ...params, label } });
}

export function openTrailer(key: string): void {
  void Linking.openURL(`https://www.youtube.com/watch?v=${key}`).catch(
    () => undefined,
  );
}
