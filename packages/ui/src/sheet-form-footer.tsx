import type * as React from "react";

import { cn } from "./utils";

export function SheetFormFooter({
  className,
  ...props
}: React.ComponentProps<"footer">) {
  return (
    <footer
      data-slot="sheet-form-footer"
      className={cn(
        "sticky bottom-0 z-10 mt-auto flex shrink-0 gap-2 border-t bg-background p-4 pb-[max(var(--kb-inset,0px),env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
}
