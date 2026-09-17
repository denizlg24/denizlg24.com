import { Skeleton } from "@repo/ui/skeleton";
import type { ReactNode } from "react";
import { StepHeading } from "./flow-step";

/** While `/api/me` decides whether a session exists: the shape of a question, not a spinner. */
export function CheckingStep() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="flex flex-col gap-8"
    >
      <Skeleton className="h-8 w-3/4" />
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-full" />
        </div>
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-4 w-36" />
      </div>
    </div>
  );
}

/** One line for a screen that is only passing through: signing in, signed out. */
export function FlowMessage({
  title,
  detail,
  action,
}: {
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6" role="status">
      <StepHeading lede={detail}>{title}</StepHeading>
      {action}
    </div>
  );
}
