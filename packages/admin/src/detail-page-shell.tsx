"use client";

import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useAdmin } from "./provider";

/**
 * The chrome every surface that used to be a sheet now shares: the standard
 * header bar, a back control pointing at the list it was opened from, and a
 * scrolling body.
 *
 * A sheet got its "close" affordance for free. A page has to carry one, and it
 * has to be the same one everywhere, which is the whole reason this exists
 * rather than each converted page rolling its own header.
 */
export function DetailPageShell({
  icon,
  title,
  backTo,
  backLabel,
  actions,
  /** Constrains the body to a readable column. Full-bleed surfaces pass false. */
  contained = true,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  backTo: string;
  backLabel: string;
  actions?: ReactNode;
  contained?: boolean;
  children: ReactNode;
}) {
  const { slots } = useAdmin();
  const router = useRouter();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader leading={slots?.sidebarTrigger} icon={icon} title={title}>
        {actions}
        <Button size="sm" variant="outline" onClick={() => router.push(backTo)}>
          <ArrowLeft className="size-3.5" />
          {backLabel}
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {contained ? (
          <div className="mx-auto max-w-5xl px-4 py-5">{children}</div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** The not-found body for a detail page whose record failed to load. */
export function DetailNotFound({
  icon,
  title,
  backTo,
  backLabel,
  message,
}: {
  icon?: ReactNode;
  title: string;
  backTo: string;
  backLabel: string;
  message: string;
}) {
  return (
    <DetailPageShell
      icon={icon}
      title={title}
      backTo={backTo}
      backLabel={backLabel}
    >
      <p className="py-16 text-center text-sm text-muted-foreground">
        {message}
      </p>
    </DetailPageShell>
  );
}

/** The loading body for a detail page, shaped like a form. */
export function DetailPageSkeleton({
  icon,
  title,
  backTo,
  backLabel,
  rows = 4,
}: {
  icon?: ReactNode;
  title: string;
  backTo: string;
  backLabel: string;
  rows?: number;
}) {
  return (
    <DetailPageShell
      icon={icon}
      title={title}
      backTo={backTo}
      backLabel={backLabel}
    >
      <div className="space-y-4">
        <div className="h-20 animate-pulse rounded-md border bg-muted/30" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: rows }).map((_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-md border bg-muted/30"
            />
          ))}
        </div>
      </div>
    </DetailPageShell>
  );
}
