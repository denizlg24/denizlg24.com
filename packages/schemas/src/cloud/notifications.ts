import { z } from "zod";

import { activitySeveritySchema } from "./activity";
import { cloudDateTimeSchema } from "./common";

export const NOTIFICATION_TYPES = [
  "task_failed",
  "task_recovered",
  "backup_completed",
  "backup_failed",
  "disk_usage_high",
  "disk_critical",
  "memory_high",
  "temperature_high",
  "service_down",
  "service_recovered",
  "container_oom",
  "container_crash_loop",
  "api_error_rate",
  "auth_failure_burst",
  "tiering_moved",
  "tiering_orphaned",
  "metric_rule",
  "metric_rule_resolved",
  "test",
] as const;
export const notificationTypeSchema = z.enum(NOTIFICATION_TYPES);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

export const notificationChannelSchema = z.enum(["email", "webhook"]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

/**
 * `subjectKey` scopes throttling within a type: one noisy container must not
 * suppress the alert for a different one, but the same container repeating is
 * exactly what the cooldown is for.
 */
export const notificationPayloadSchema = z.object({
  type: notificationTypeSchema,
  severity: activitySeveritySchema,
  subjectKey: z.string().min(1).max(255),
  title: z.string().min(1).max(255),
  message: z.string().max(4_000),
  url: z.url().optional(),
  details: z.record(z.string(), z.string()).optional(),
});
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export const safeNotificationEventSchema = z.object({
  id: z.uuid(),
  eventKey: z.string(),
  type: notificationTypeSchema,
  severity: activitySeveritySchema,
  firstSeenAt: cloudDateTimeSchema,
  lastSeenAt: cloudDateTimeSchema,
  lastSentAt: cloudDateTimeSchema.nullable(),
  sendCount: z.number().int().nonnegative(),
  suppressedCount: z.number().int().nonnegative(),
  lastPayload: notificationPayloadSchema.nullable(),
});
export type SafeNotificationEvent = z.infer<typeof safeNotificationEventSchema>;

export const notificationDeliverySchema = z.object({
  channel: notificationChannelSchema,
  enabled: z.boolean(),
  sent: z.boolean(),
  error: z.string().nullable(),
});
export type NotificationDelivery = z.infer<typeof notificationDeliverySchema>;

export const notificationTestResultSchema = z.object({
  deliveries: z.array(notificationDeliverySchema),
});
export type NotificationTestResult = z.infer<
  typeof notificationTestResultSchema
>;

/**
 * Per-type cooldowns in minutes. A disk filling up is worth repeating every few
 * hours; a container OOM that keeps recurring is worth knowing about sooner.
 */
export const NOTIFICATION_COOLDOWN_MINUTES: Record<NotificationType, number> = {
  task_failed: 60,
  task_recovered: 0,
  backup_completed: 0,
  backup_failed: 60,
  disk_usage_high: 360,
  disk_critical: 60,
  memory_high: 180,
  temperature_high: 60,
  service_down: 30,
  service_recovered: 0,
  container_oom: 30,
  container_crash_loop: 60,
  api_error_rate: 60,
  auth_failure_burst: 30,
  tiering_moved: 0,
  tiering_orphaned: 0,
  // Rules carry their own cooldown and pass it explicitly; this is only the
  // fallback for a dispatch that somehow arrives without one.
  metric_rule: 60,
  metric_rule_resolved: 0,
  test: 0,
};
