import type * as React from "react";

import { cn } from "./utils";

export function BottomTabBar({
  className,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="bottom-tab-bar"
      aria-label={props["aria-label"] ?? "Primary navigation"}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80",
        className,
      )}
      {...props}
    />
  );
}
