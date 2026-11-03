import type {
  CodingRunFailureCode,
  CodingRunStatus,
  FindingSeverity,
  SprintSlotKind,
  SprintSlotStatus,
  SprintStatus,
} from "@repo/schemas";
import type { StatusTone } from "@repo/ui/status-dot";
import { AdminApiError } from "../client";

export type BadgeTone = "good" | "warning" | "critical" | "info" | "secondary";

export const SPRINT_STATUS_BADGE: Record<SprintStatus, BadgeTone> = {
  draft: "secondary",
  active: "info",
  completed: "good",
  cancelled: "secondary",
};

export const SLOT_STATUS_BADGE: Record<SprintSlotStatus, BadgeTone> = {
  scheduled: "secondary",
  waiting: "warning",
  queued: "info",
  running: "warning",
  succeeded: "good",
  failed: "critical",
  skipped: "secondary",
  cancelled: "secondary",
};

export const RUN_STATUS_TONE: Record<CodingRunStatus, StatusTone> = {
  queued: "muted",
  running: "warning",
  succeeded: "good",
  failed: "critical",
  cancelled: "muted",
};

export const SLOT_KIND_LABEL: Record<SprintSlotKind, string> = {
  implement: "Implement",
  review: "Review",
  "fix-review": "Fix review",
  release: "Release",
  custom: "Custom",
};

/** Left-edge accent of a slot block, by kind. */
export const SLOT_KIND_ACCENT: Record<SprintSlotKind, string> = {
  implement: "border-l-status-info",
  review: "border-l-status-warning",
  "fix-review": "border-l-status-serious",
  release: "border-l-status-good",
  custom: "border-l-border",
};

export const FAILURE_LABEL: Record<CodingRunFailureCode, string> = {
  timeout: "Timeout",
  "runner-lost": "Runner lost",
  "harness-error": "Harness error",
  "no-result": "No result",
  "push-rejected": "Push rejected",
  "ci-failed": "CI failed",
  "admission-timeout": "Admission timeout",
  "workspace-error": "Workspace error",
  cancelled: "Cancelled",
};

export const SEVERITY_ORDER: readonly FindingSeverity[] = [
  "blocker",
  "major",
  "minor",
  "nit",
];

export const SEVERITY_TONE: Record<FindingSeverity, StatusTone> = {
  blocker: "critical",
  major: "serious",
  minor: "warning",
  nit: "muted",
};

export function isLiveSlotStatus(status: SprintSlotStatus): boolean {
  return status === "queued" || status === "running";
}

/** Only a slot that has not fired yet may move or change. */
export function isEditableSlotStatus(status: SprintSlotStatus): boolean {
  return status === "scheduled" || status === "waiting";
}

export function canRetrySlot(status: SprintSlotStatus): boolean {
  return status === "failed" || status === "skipped" || status === "cancelled";
}

const ABSOLUTE = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatAbsolute(value: string | Date): string {
  return ABSOLUTE.format(typeof value === "string" ? new Date(value) : value);
}

export function shortSha(sha: string | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
}

export function githubUrl(repo: string, path = ""): string {
  return `https://github.com/${repo}${path}`;
}

/** `yyyy-MM-ddTHH:mm` in local time, the shape `DateTimePicker` edits. */
export function toLocalInput(value: Date): string {
  const pad = (part: number) => `${part}`.padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(
    value.getDate(),
  )}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function fromLocalInput(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The `code` an admin route answered with, e.g. `BRANCH_LOCKED`. */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof AdminApiError)) return null;
  const code = error.details?.code ?? error.details?.error;
  return typeof code === "string" ? code : null;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
