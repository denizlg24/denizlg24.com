import { MacrosQuickActions } from "@modules/macros-quick-actions";
import { type Href, router } from "expo-router";
import { useEffect } from "react";
import { quickAddHref, weighInHref } from "@/features/today/links";

/** Types match `UIApplicationShortcutItems` in app.config.ts. */
const DESTINATIONS: Record<string, () => Href> = {
  "com.denizlg24.macros.search": () => "/add-food",
  "com.denizlg24.macros.scan": () => "/scan",
  "com.denizlg24.macros.quick-add": () => quickAddHref(),
  "com.denizlg24.macros.weigh-in": () => weighInHref(),
};

function open(type: string | null) {
  const destination = type ? DESTINATIONS[type] : undefined;
  if (destination) router.push(destination());
}

/**
 * Home Screen quick actions (long press the app icon). Mounted inside the
 * signed-in stack, so a cold launch from one waits for sign-in to finish
 * before it routes.
 */
export function QuickActions() {
  useEffect(() => {
    if (!MacrosQuickActions) return;
    open(MacrosQuickActions.takePending());
    const subscription = MacrosQuickActions.addListener("onAction", (event) =>
      open(event.type),
    );
    return () => subscription.remove();
  }, []);
  return null;
}
