import type { ReactNode } from "react";
import { cn } from "./utils";

// The standard dashboard header bar: icon + title + actions in an h-12
// border-b container. `leading` is the slot for R1's mobile SidebarTrigger.
export function PageHeader({
  icon,
  title,
  leading,
  className,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  leading?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-12 shrink-0 items-center gap-2 border-b px-4",
        className,
      )}
    >
      {leading}
      {icon}
      <span className="flex-1 text-sm font-semibold">{title}</span>
      {children}
    </div>
  );
}
