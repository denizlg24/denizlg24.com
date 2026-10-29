"use client";

import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { useAdmin } from "./provider";

/**
 * The chrome every record page shares: the header bar with a breadcrumb back
 * to the list it was opened from, and a scrolling body. The breadcrumb is the
 * "close" affordance a sheet used to give for free, the same everywhere.
 */
export function DetailPageShell({
  icon,
  title,
  backTo,
  backLabel,
  actions,
  /** Constrains the body to a readable column. Full-bleed surfaces pass false. */
  contained = true,
  width = "default",
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  backTo: string;
  backLabel: string;
  actions?: ReactNode;
  contained?: boolean;
  width?: ComponentProps<typeof PageBody>["width"];
  children: ReactNode;
}) {
  const { slots } = useAdmin();
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={[{ label: backLabel, onClick: () => router.push(backTo) }]}
        icon={icon}
        title={title}
      >
        {actions}
      </PageHeader>
      {contained ? (
        <PageBody width={width}>{children}</PageBody>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      )}
    </Page>
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
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <div className="flex flex-col gap-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            key={index}
            className="grid grid-cols-[10rem_1fr] items-center gap-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ))}
      </div>
    </DetailPageShell>
  );
}
