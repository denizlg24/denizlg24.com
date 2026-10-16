import { z } from "zod";

/**
 * Every notification the dashboard iPhone app can show. One table read by the
 * Settings screen, the server's per-device filter and every sender, so a kind
 * is never on in one place and unknown in another.
 *
 * `server` kinds are filtered on the server: iOS shows an alert push before
 * any app code runs, so a phone-side toggle could not suppress it. `local`
 * kinds are planned on the phone from cached data and simply not scheduled
 * when off.
 */
export const DASHBOARD_NOTIFICATION_KINDS = [
  "contact_new",
  "triage_urgent",
  "triage_digest",
  "course_email",
  "comment_pending",
  "event_starting",
  "class_starting",
  "assignment_due",
  "morning_brief",
  "budget_projected",
  "budget_overspent",
  "income_missed",
  "subscription_changed",
  "match_review",
  "order_filled",
  "stop_triggered",
  "margin_call",
  "task_failed",
  "task_finished",
  "chat_reply",
  "memory_review",
  "memory_contradiction",
  "incident",
  "resource_down",
  "cloud_task_failed",
  "backup_failed",
  "host_pressure",
  "container_unhealthy",
  "tiering_problem",
  "forge_disk_low",
  "forge_deploy_failed",
  "metric_alert",
  "auth_failure_burst",
  "new_sign_in",
  "credential_changed",
] as const;

export const dashboardNotificationKindSchema = z.enum(
  DASHBOARD_NOTIFICATION_KINDS,
);
export type DashboardNotificationKind = z.infer<
  typeof dashboardNotificationKindSchema
>;

export const DASHBOARD_NOTIFICATION_GROUPS = [
  "Inbox",
  "Calendar",
  "Money",
  "Agent",
  "Infra",
  "Security",
] as const;
export type DashboardNotificationGroup =
  (typeof DASHBOARD_NOTIFICATION_GROUPS)[number];

/** APNs `interruption-level`, and the same for a local notification. */
export const notificationLevelSchema = z.enum([
  "passive",
  "active",
  "time-sensitive",
]);
export type NotificationLevel = z.infer<typeof notificationLevelSchema>;

export interface DashboardNotificationSpec {
  group: DashboardNotificationGroup;
  label: string;
  level: NotificationLevel;
  default: boolean;
  source: "server" | "local";
}

export const DASHBOARD_NOTIFICATIONS: Record<
  DashboardNotificationKind,
  DashboardNotificationSpec
> = {
  contact_new: {
    group: "Inbox",
    label: "New contact ticket",
    level: "active",
    default: true,
    source: "server",
  },
  triage_urgent: {
    group: "Inbox",
    label: "Urgent triage suggestion",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  triage_digest: {
    group: "Inbox",
    label: "Triage digest",
    level: "passive",
    default: true,
    source: "server",
  },
  course_email: {
    group: "Inbox",
    label: "Course email matched",
    level: "active",
    default: true,
    source: "server",
  },
  comment_pending: {
    group: "Inbox",
    label: "Comment awaiting moderation",
    level: "passive",
    default: false,
    source: "server",
  },
  event_starting: {
    group: "Calendar",
    label: "Event starting",
    level: "time-sensitive",
    default: true,
    source: "local",
  },
  class_starting: {
    group: "Calendar",
    label: "Class starting",
    level: "active",
    default: true,
    source: "local",
  },
  assignment_due: {
    group: "Calendar",
    label: "Assignment due",
    level: "time-sensitive",
    default: true,
    source: "local",
  },
  morning_brief: {
    group: "Calendar",
    label: "Morning brief",
    level: "passive",
    default: true,
    source: "server",
  },
  budget_projected: {
    group: "Money",
    label: "Budget projected to overspend",
    level: "active",
    default: true,
    source: "server",
  },
  budget_overspent: {
    group: "Money",
    label: "Budget overspent",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  income_missed: {
    group: "Money",
    label: "Income missed",
    level: "active",
    default: true,
    source: "server",
  },
  subscription_changed: {
    group: "Money",
    label: "Subscription price changed",
    level: "passive",
    default: true,
    source: "server",
  },
  match_review: {
    group: "Money",
    label: "Match review waiting",
    level: "passive",
    default: false,
    source: "server",
  },
  order_filled: {
    group: "Money",
    label: "Order filled",
    level: "active",
    default: true,
    source: "server",
  },
  stop_triggered: {
    group: "Money",
    label: "Stop triggered",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  margin_call: {
    group: "Money",
    label: "Margin call",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  task_failed: {
    group: "Agent",
    label: "Task run failed",
    level: "active",
    default: true,
    source: "server",
  },
  task_finished: {
    group: "Agent",
    label: "Task run finished",
    level: "passive",
    default: false,
    source: "server",
  },
  chat_reply: {
    group: "Agent",
    label: "Chat reply while away",
    level: "active",
    default: true,
    source: "server",
  },
  memory_review: {
    group: "Agent",
    label: "Memory review waiting",
    level: "passive",
    default: false,
    source: "server",
  },
  memory_contradiction: {
    group: "Agent",
    label: "Memory contradiction",
    level: "passive",
    default: false,
    source: "server",
  },
  incident: {
    group: "Infra",
    label: "Incident opened or resolved",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  resource_down: {
    group: "Infra",
    label: "Resource down or recovered",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  cloud_task_failed: {
    group: "Infra",
    label: "Cloud task failed or recovered",
    level: "active",
    default: true,
    source: "server",
  },
  backup_failed: {
    group: "Infra",
    label: "Backup failed",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  host_pressure: {
    group: "Infra",
    label: "Disk, memory or temperature high",
    level: "active",
    default: true,
    source: "server",
  },
  container_unhealthy: {
    group: "Infra",
    label: "Container OOM or crash loop",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  tiering_problem: {
    group: "Infra",
    label: "Tiering orphaned or quarantined",
    level: "active",
    default: true,
    source: "server",
  },
  forge_disk_low: {
    group: "Infra",
    label: "Forge disk low",
    level: "active",
    default: true,
    source: "server",
  },
  forge_deploy_failed: {
    group: "Infra",
    label: "Forge deployment failed",
    level: "active",
    default: true,
    source: "server",
  },
  metric_alert: {
    group: "Infra",
    label: "Metric alert",
    level: "active",
    default: true,
    source: "server",
  },
  auth_failure_burst: {
    group: "Security",
    label: "Auth failure burst",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
  new_sign_in: {
    group: "Security",
    label: "New sign-in",
    level: "active",
    default: true,
    source: "server",
  },
  credential_changed: {
    group: "Security",
    label: "Passkey added or MFA reset",
    level: "time-sensitive",
    default: true,
    source: "server",
  },
};

/** Per-kind toggles as stored: a missing key means the kind's default. */
export const dashboardNotificationPrefsSchema = z.partialRecord(
  dashboardNotificationKindSchema,
  z.boolean(),
);
export type DashboardNotificationPrefs = z.infer<
  typeof dashboardNotificationPrefsSchema
>;

export function notificationEnabled(
  prefs: DashboardNotificationPrefs | undefined,
  kind: DashboardNotificationKind,
): boolean {
  return prefs?.[kind] ?? DASHBOARD_NOTIFICATIONS[kind].default;
}

/** Lead times for the kinds the phone plans itself. */
export const dashboardLocalNotificationSettingsSchema = z.object({
  eventLeadMinutes: z.number().int().min(0).max(240).default(10),
  classLeadMinutes: z.number().int().min(0).max(120).default(10),
});
export type DashboardLocalNotificationSettings = z.infer<
  typeof dashboardLocalNotificationSettingsSchema
>;
