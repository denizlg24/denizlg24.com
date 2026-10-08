import type {
  MacrosContribution,
  MacrosFoodReportReason,
  MacrosModerationEvent,
  MacrosModerationFood,
  MacrosReportCase,
} from "@repo/schemas/macros";
import type { StatusTone } from "@repo/ui/status-dot";

import { shortId } from "@/lib/format";

/** `removedBy` on a hold the report threshold placed, not a person. */
export const AUTO_ACTOR = "auto";

export type ModerationState =
  | "open"
  | "auto-hidden"
  | "removed"
  | "dismissed"
  | "visible";

export const STATE_META: Record<
  ModerationState,
  { label: string; tone: StatusTone }
> = {
  open: { label: "Open", tone: "warning" },
  "auto-hidden": { label: "Auto-hidden", tone: "serious" },
  removed: { label: "Removed", tone: "critical" },
  dismissed: { label: "Dismissed", tone: "muted" },
  visible: { label: "Visible", tone: "good" },
};

export const REASON_SHORT_LABELS: Record<MacrosFoodReportReason, string> = {
  offensive: "Offensive",
  spam: "Spam",
  incorrect: "Incorrect",
  personal_info: "Personal info",
  other: "Other",
};

/**
 * An open case on a removed food is a hold: the owner removing it closes
 * every open report in the same step. A dataset food has no contribution row,
 * so its hold carries no `removedBy` at all.
 */
export function isAutoHidden(
  food: Pick<MacrosModerationFood, "removed" | "removedBy">,
  open: boolean,
): boolean {
  return (
    food.removed &&
    (food.removedBy === AUTO_ACTOR || (open && food.removedBy === null))
  );
}

export function caseState(item: MacrosReportCase): ModerationState {
  if (isAutoHidden(item.food, item.open)) return "auto-hidden";
  if (item.food.removed) return "removed";
  return item.open ? "open" : "dismissed";
}

export function contributionState(item: MacrosContribution): ModerationState {
  if (!item.removed) return "visible";
  return item.removedBy === AUTO_ACTOR ? "auto-hidden" : "removed";
}

const REASON_ORDER: readonly MacrosFoodReportReason[] = [
  "offensive",
  "personal_info",
  "spam",
  "incorrect",
  "other",
];

export function reasonEntries(
  byReason: MacrosReportCase["byReason"],
): [MacrosFoodReportReason, number][] {
  return REASON_ORDER.map((reason): [MacrosFoodReportReason, number] => [
    reason,
    byReason[reason] ?? 0,
  ])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
}

type Detail = MacrosModerationEvent["detail"];

function detailString(detail: Detail, key: string): string | null {
  const value = detail?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function detailNumber(detail: Detail, key: string): number | null {
  const value = detail?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detailFlag(detail: Detail, key: string): boolean {
  return detail?.[key] === true;
}

export interface EventSubject {
  kind: "food" | "contributor" | "other";
  id: string;
  label: string;
  href: string | null;
}

export interface EventView {
  id: string;
  createdAt: string;
  action: string;
  tone: StatusTone;
  actor: string;
  detail: string | null;
  subject: EventSubject;
}

function describeAction(event: MacrosModerationEvent): {
  action: string;
  tone: StatusTone;
} {
  const { detail } = event;
  switch (event.action) {
    case "food.removed":
      return event.actor === AUTO_ACTOR
        ? { action: "Auto-hidden", tone: "serious" }
        : { action: "Removed", tone: "critical" };
    case "food.restored":
      return { action: "Restored", tone: "good" };
    case "reports.dismissed": {
      const count = detailNumber(detail, "reports");
      return {
        action:
          count === null
            ? "Reports dismissed"
            : `Dismissed ${count} report${count === 1 ? "" : "s"}`,
        tone: "muted",
      };
    }
    case "contributor.restricted": {
      if (detailFlag(detail, "suspended")) {
        return { action: "Account suspended", tone: "critical" };
      }
      if (detailFlag(detail, "sharingSuspended")) {
        return { action: "Sharing suspended", tone: "serious" };
      }
      return { action: "Restrictions lifted", tone: "good" };
    }
    case "contributor.contact_revealed":
      return { action: "Email revealed", tone: "warning" };
    default:
      return { action: event.action, tone: "muted" };
  }
}

function describeSubject(
  event: MacrosModerationEvent,
  labels: ReadonlyMap<string, string>,
): EventSubject {
  const id = event.subjectId;
  const known = labels.get(id);
  if (event.subjectType === "food") {
    return {
      kind: "food",
      id,
      label: known ?? `Food ${shortId(id)}`,
      href: `/reports/${id}`,
    };
  }
  if (event.subjectType === "contributor") {
    return {
      kind: "contributor",
      id,
      label: known ?? "Contributor",
      href: `/contributors/${id}`,
    };
  }
  return { kind: "other", id, label: known ?? shortId(id), href: null };
}

export function actorLabel(actor: string, ownerId: string | null): string {
  if (actor === AUTO_ACTOR) return "auto";
  if (ownerId && actor === ownerId) return "owner";
  return shortId(actor);
}

export function describeEvent(
  event: MacrosModerationEvent,
  context: { ownerId: string | null; labels: ReadonlyMap<string, string> },
): EventView {
  return {
    id: event.id,
    createdAt: event.createdAt,
    ...describeAction(event),
    actor: actorLabel(event.actor, context.ownerId),
    detail: detailString(event.detail, "reason"),
    subject: describeSubject(event, context.labels),
  };
}
