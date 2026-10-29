"use client";

import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { Settings2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useAdmin } from "../provider";
import { SETTINGS_SECTIONS } from "./settings-nav";

const RAIL_CLASS =
  "flex shrink-0 gap-0.5 overflow-x-auto border-b px-3 py-2 md:w-52 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-b-0 md:border-r md:px-2 md:py-3";

const RAIL_ITEM_CLASS =
  "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-[13px] transition-colors [&_svg:not([class*='size-'])]:size-3.5";

function useRailEntries() {
  const { slots } = useAdmin();
  return [
    ...SETTINGS_SECTIONS.map((section) => ({
      slug: section.slug,
      label: section.label,
      icon: <section.icon />,
    })),
    ...(slots?.settingsExtraSections ?? []),
  ];
}

/**
 * Chrome shared by every settings sub-page: the header, the section rail, and a
 * narrow scrolling column. Each section is its own route in both apps, so the
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
  const entries = useRailEntries();
  const current = entries.find((entry) => entry.slug === active);

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Settings2 />}
        crumbs={[{ label: "Settings" }]}
        title={title ?? current?.label ?? "Settings"}
      >
        {actions}
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Settings sections" className={RAIL_CLASS}>
          {entries.map((entry) => {
            const isActive = entry.slug === active;
            return (
              <Link
                key={entry.slug}
                href={`${base}/${entry.slug}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  RAIL_ITEM_CLASS,
                  isActive
                    ? "bg-surface font-medium text-accent-strong"
                    : "text-muted-foreground hover:bg-surface/60 hover:text-accent-strong",
                )}
              >
                <span className="shrink-0">{entry.icon}</span>
                <span className="truncate">{entry.label}</span>
              </Link>
            );
          })}
        </nav>
        <PageBody width="narrow">{children}</PageBody>
      </div>
    </Page>
  );
}

/** A labelled block inside a settings section: a Section with an optional one-line note. */
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
    <Section title={label} actions={actions}>
      {description && (
        <p className="-mt-1 text-xs text-muted-foreground">{description}</p>
      )}
      {children}
    </Section>
  );
}

/** One setting: label (and an optional terse hint) on the left, its control on the right. */
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
        "flex min-h-9 gap-2",
        stacked
          ? "flex-col"
          : "flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-6",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        {/* Most rows hold a Radix control that carries its own aria-label, so a
            bare <label> would point at nothing — only emit one when bound. */}
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm text-accent-strong">
            {label}
          </label>
        ) : (
          <span className="text-sm text-accent-strong">{label}</span>
        )}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      <div
        className={cn(
          "flex min-w-0 items-center",
          stacked ? "w-full" : "sm:w-72 sm:shrink-0 sm:justify-end",
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SettingsSkeleton({ active }: { active: string }) {
  // Match the real shell's rail exactly, extra slots included, so the
  // placeholder is not one row short and does not shift on mount.
  const { slots } = useAdmin();
  const entries = useRailEntries();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Settings2 />}
        crumbs={[{ label: "Settings" }]}
        title={
          entries.find((entry) => entry.slug === active)?.label ?? "Settings"
        }
      />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav className={RAIL_CLASS}>
          {entries.map((entry) => (
            <div
              key={entry.slug}
              className={cn(
                RAIL_ITEM_CLASS,
                "text-muted-foreground",
                entry.slug === active && "bg-surface",
              )}
            >
              <span className="shrink-0">{entry.icon}</span>
              <span className="truncate">{entry.label}</span>
            </div>
          ))}
        </nav>
        <PageBody width="narrow">
          {[0, 1, 2].map((group) => (
            <div key={group} className="flex flex-col gap-3">
              <Skeleton className="h-3 w-24" />
              {[0, 1].map((row) => (
                <div key={row} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-8 w-56" />
                </div>
              ))}
            </div>
          ))}
        </PageBody>
      </div>
    </Page>
  );
}
