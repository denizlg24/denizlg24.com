import { type Href, router, useNavigation } from "expo-router";
import type { LogTimeParams } from "@/lib/log-time";

const HUB_ROUTE = "add-food";

/**
 * Whether the add-food hub sits beneath the screen asking. The food and
 * recipe sheets, the scanner and New food are all presented on the app's
 * root stack, from the hub or from elsewhere (My foods, the "+" sheet).
 */
export function useHubBelow(): () => boolean {
  const navigation = useNavigation();
  return () =>
    navigation.getState()?.routes.some((route) => route.name === HUB_ROUTE) ??
    false;
}

/**
 * Leaves the current screen for the hub: back to it when it is underneath,
 * otherwise in its place, opened at `time`. `then` opens on top of the hub in
 * the same step, so a scanned food shows in the same sheet a searched one
 * does, over the search it belongs to.
 */
export function goToHub(hubBelow: boolean, time: LogTimeParams, then?: Href) {
  if (hubBelow) router.back();
  else router.replace({ pathname: "/add-food", params: time });
  if (then) router.push(then);
}
