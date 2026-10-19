import { cn } from "@repo/ui/utils";
import type { ReactNode } from "react";

export const fieldLabel =
  "flex flex-col gap-1.5 text-[13px] text-muted-foreground";

export const fieldInput =
  "h-11 w-full min-w-0 rounded-none border-0 border-b bg-transparent p-0 text-base text-foreground transition-[border-color,box-shadow] outline-none focus-visible:border-foreground focus-visible:shadow-[0_1px_0_0_var(--foreground)] disabled:opacity-60";

export const actionButton =
  "inline-flex h-10 flex-none items-center justify-center rounded-full bg-foreground px-5 text-sm font-semibold whitespace-nowrap text-background transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-35";

export const dangerButton =
  "inline-flex h-10 flex-none items-center justify-center rounded-full bg-destructive px-5 text-sm font-semibold whitespace-nowrap text-background transition-opacity hover:opacity-85 disabled:cursor-default disabled:opacity-35";

export const textButton =
  "text-sm font-medium whitespace-nowrap text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground hover:decoration-foreground disabled:cursor-default disabled:opacity-50";

export type Status = { tone: "success" | "error"; text: string };

/**
 * Always rendered, so screen readers announce what lands in it, and placed
 * beside the control whose result it reports.
 */
export function FormStatus({
  id,
  status,
  className,
}: {
  id?: string;
  status: Status | null;
  className?: string;
}) {
  return (
    <p
      id={id}
      role="status"
      className={cn(
        "text-sm leading-relaxed text-pretty",
        status?.tone === "error" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {status?.text}
    </p>
  );
}

export function AccountSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="grid scroll-mt-24 gap-5 border-t py-8 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10"
    >
      <h2 id={`${id}-title`} className="text-[15px] font-semibold">
        {title}
      </h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
