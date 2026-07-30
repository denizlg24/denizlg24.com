"use client";

import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import { cn } from "@repo/ui/utils";
import { Settings2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAdmin } from "../provider";
import { SETTINGS_SECTIONS } from "./settings-nav";

/**
 * Chrome shared by every settings sub-page: the header, the section rail, and a
 * scrollable content column. Each section is its own route in both apps, so the
 * active slug is passed in rather than derived from the pathname (the two apps
 * mount the feature at different bases).
 */
export function SettingsShell({
  active,
  title,
  actions,
  children,
}: {
  active: string;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { routes, slots } = useAdmin();
  const base = routes.settings.replace(/\/$/, "");

  const entries = [
    ...SETTINGS_SECTIONS.map((section) => ({
      slug: section.slug,
      label: section.label,
      icon: <section.icon className="size-3.5" />,
    })),
    ...(slots?.settingsExtraSections ?? []),
  ];

  const current = entries.find((entry) => entry.slug === active);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={<Settings2 className="size-4 text-muted-foreground" />}
        title={
          <span className="flex items-baseline gap-2">
            <span>Settings</span>
            {(title ?? current?.label) && (
              <>
                <span className="text-muted-foreground/40">/</span>
                <span className="font-normal text-muted-foreground">
                  {title ?? current?.label}
                </span>
              </>
            )}
          </span>
        }
        leading={slots?.sidebarTrigger}
      >
        {actions}
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 md:w-52 md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:px-2 md:py-3"
        >
          {entries.map((entry) => {
            const isActive = entry.slug === active;
            return (
              <Link
                key={entry.slug}
                href={`${base}/${entry.slug}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs transition-colors",
                  isActive
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "shrink-0",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {entry.icon}
                </span>
                <span className="truncate">{entry.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="max-w-3xl px-4 py-5 md:px-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * A labelled block inside a settings section. Hairline rule instead of a card
 * border — the sections stay flat and scannable.
 */
export function SettingsGroup({
  label,
  description,
  actions,
  children,
}: {
  label: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 py-6 first:pt-0 [&+&]:border-t">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </h2>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A single labelled control row: label + optional hint on the left, control right. */
export function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
  stacked,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-3",
        stacked
          ? "flex-col"
          : "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        {/* Most rows hold a Radix control that carries its own aria-label, so a
            bare <label> would point at nothing — only emit one when bound. */}
        {htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="block text-sm font-medium leading-none"
          >
            {label}
          </label>
        ) : (
          <span className="block text-sm font-medium leading-none">
            {label}
          </span>
        )}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div
        className={cn("min-w-0", stacked ? "w-full" : "sm:w-72 sm:shrink-0")}
      >
        {children}
      </div>
    </div>
  );
}

export function SettingsSkeleton({ active }: { active: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBarSkeleton
        icon={<Settings2 className="size-4 text-muted-foreground" />}
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-hidden border-b px-3 py-2 md:w-52 md:flex-col md:gap-0.5 md:border-b-0 md:border-r md:px-2 md:py-3">
          {SETTINGS_SECTIONS.map((section) => (
            <div
              key={section.slug}
              className={cn(
                "flex items-center gap-2 rounded-sm px-2.5 py-1.5",
                section.slug === active && "bg-accent",
              )}
            >
              <Skeleton className="size-3.5 shrink-0 rounded-xs" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="max-w-3xl space-y-8 px-4 py-5 md:px-6">
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-3">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-8 w-full max-w-sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
