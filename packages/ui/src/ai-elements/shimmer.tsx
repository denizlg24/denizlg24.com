import type { ElementType, ReactNode } from "react";

import { cn } from "../utils";

export type ShimmerProps = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  /** Seconds per sweep. */
  duration?: number;
};

export const Shimmer = ({
  children,
  as: Component = "span",
  className,
  duration,
}: ShimmerProps) => (
  <Component
    data-slot="shimmer"
    className={cn("shimmer motion-reduce:animate-none", className)}
    style={
      duration === undefined ? undefined : { animationDuration: `${duration}s` }
    }
  >
    {children}
  </Component>
);
