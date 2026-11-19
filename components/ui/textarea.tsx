import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-base leading-snug transition-[border-color] duration-100 placeholder:text-muted-foreground hover:border-rule-strong/40 focus-visible:border-ring focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-[0.8125rem]",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
