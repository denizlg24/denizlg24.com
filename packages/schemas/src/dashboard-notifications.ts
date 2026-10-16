import { z } from "zod";
import {
  type NotificationType,
  notificationTypeSchema,
} from "./cloud/notifications";

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

/**
 * Where a cloud ops notification lands on the phone; null for the ones that
 * would only be noise there (a backup that worked, a file that moved tier,
 * the test message).
 */
export const CLOUD_NOTIFICATION_KINDS: Record<
  NotificationType,
  { kind: DashboardNotificationKind; level?: NotificationLevel } | null
> = {
  task_failed: { kind: "cloud_task_failed" },
  task_recovered: { kind: "cloud_task_failed", level: "passive" },
  backup_completed: null,
  backup_failed: { kind: "backup_failed" },
  disk_usage_high: { kind: "host_pressure" },
  disk_critical: { kind: "host_pressure", level: "time-sensitive" },
  memory_high: { kind: "host_pressure" },
  temperature_high: { kind: "host_pressure" },
  service_down: { kind: "resource_down" },
  service_recovered: { kind: "resource_down", level: "passive" },
  container_oom: { kind: "container_unhealthy" },
  container_crash_loop: { kind: "container_unhealthy" },
  api_error_rate: { kind: "metric_alert" },
  auth_failure_burst: { kind: "auth_failure_burst" },
  tiering_moved: null,
  tiering_orphaned: { kind: "tiering_problem" },
  tiering_quarantined: { kind: "tiering_problem" },
  forge_disk_low: { kind: "forge_disk_low" },
  metric_rule: { kind: "metric_alert" },
  metric_rule_resolved: { kind: "metric_alert", level: "passive" },
  forge_deploy_failed: { kind: "forge_deploy_failed" },
  auth_sign_in: { kind: "new_sign_in" },
  auth_credential_changed: { kind: "credential_changed" },
  test: null,
};

/**
 * `POST /api/mobile/notify`: a push from the cloud API or the status page.
 * Either names a dashboard kind outright or a cloud type mapped through
 * `CLOUD_NOTIFICATION_KINDS`. `dedupeKey` collapses repeats on the phone.
 */
export const mobileNotifyInputSchema = z
  .object({
    kind: dashboardNotificationKindSchema.optional(),
    cloudType: notificationTypeSchema.optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().max(300).optional(),
    dedupeKey: z.string().trim().min(1).max(255),
    url: z
      .string()
      .regex(/^dashboard:\/\//, "A dashboard:// link")
      .max(500)
      .optional(),
    level: notificationLevelSchema.optional(),
  })
  .refine(
    (value) => value.kind !== undefined || value.cloudType !== undefined,
    {
      message: "kind or cloudType is required",
    },
  );
export type MobileNotifyInput = z.infer<typeof mobileNotifyInputSchema>;

export type ResolvedMobileNotify = {
  kind: DashboardNotificationKind;
  level?: NotificationLevel;
};

/** The kind and level a notify request resolves to; null when it is not for the phone. */
export function resolveMobileNotify(
  input: Pick<MobileNotifyInput, "kind" | "cloudType" | "level">,
): ResolvedMobileNotify | null {
  if (input.kind) {
    return { kind: input.kind, ...(input.level ? { level: input.level } : {}) };
  }
  if (!input.cloudType) return null;
  const mapped = CLOUD_NOTIFICATION_KINDS[input.cloudType];
  if (!mapped) return null;
  const level = input.level ?? mapped.level;
  return { kind: mapped.kind, ...(level ? { level } : {}) };
}
