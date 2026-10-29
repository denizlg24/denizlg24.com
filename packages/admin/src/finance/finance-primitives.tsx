"use client";

import type { FinanceAccount } from "@repo/schemas";
import { EmptyState } from "@repo/ui/empty-state";
import { FormField } from "@repo/ui/form-dialog";
import { SectionLabel } from "@repo/ui/section";
import { Stat } from "@repo/ui/stat";
import type { StatusTone } from "@repo/ui/status-dot";
import { formatDistanceToNowStrict } from "date-fns";
import type { ReactNode } from "react";

export function relative(value?: string) {
  if (!value) return "never";
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export const CONNECTION_TONE: Record<
  FinanceAccount["connection"]["status"],
  StatusTone
> = {
  active: "good",
  pending: "warning",
  reconnect_required: "critical",
  disconnected: "muted",
};

/*
 * The four helpers below predate @repo/ui's section/stat/empty-state/form
 * primitives. Finance itself uses those directly; hours and holdings still
 * import these names, so they stay as thin adapters onto the primitives.
 */

export function SectionHead({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return <SectionLabel actions={children}>{label}</SectionLabel>;
}

export function Figure({
  label,
  value,
  meta,
  tone,
}: {
  label: string;
  value: string;
  meta?: ReactNode;
  tone?: "good" | "critical";
}) {
  return <Stat label={label} value={value} hint={meta} tone={tone} />;
}

export function Empty({
  label,
  compact,
}: {
  label: string;
  compact?: boolean;
}) {
  return <EmptyState label={label} compact={compact} />;
}

export function FieldRow({
  label,
  children,
  htmlFor,
  className,
}: {
  label: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <FormField label={label} htmlFor={htmlFor} className={className}>
      {children}
    </FormField>
  );
}
