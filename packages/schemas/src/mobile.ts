import { z } from "zod";
import { dashboardNotificationPrefsSchema } from "./dashboard-notifications";

/** The iPhone apps that sign in to the admin API. */
export const mobileAppSchema = z.enum([
  "hours",
  "voice",
  "location",
  "dashboard",
]);
export type MobileApp = z.infer<typeof mobileAppSchema>;

/** Development builds (Xcode, `expo run:ios`) register with sandbox APNs. */
export const apnsEnvironmentSchema = z.enum(["development", "production"]);
export type ApnsEnvironment = z.infer<typeof apnsEnvironmentSchema>;

const apnsTokenSchema = z
  .string()
  .regex(/^[0-9a-f]{64,200}$/i, "Not an APNs token");

export const mobileLiveActivitySchema = z.object({
  activityId: z.string().min(1).max(100),
  /** The per-activity update token ActivityKit hands out. */
  token: apnsTokenSchema,
});

/**
 * Everything one installation can be reached by, sent whole on every change:
 * an activity missing from `liveActivities` has ended on the phone.
 */
export const mobileDeviceInputSchema = z.object({
  app: mobileAppSchema,
  environment: apnsEnvironmentSchema,
  name: z.string().trim().max(80).optional(),
  pushToken: apnsTokenSchema.nullable().default(null),
  /** ActivityKit's push-to-start token (iOS 17.2+). */
  liveActivityStartToken: apnsTokenSchema.nullable().default(null),
  liveActivities: z.array(mobileLiveActivitySchema).max(10).default([]),
  /**
   * The dashboard app's per-kind toggles. Pushes are filtered on the server
   * because iOS shows an alert before any app code can run. Absent leaves
   * whatever is stored.
   */
  notifications: dashboardNotificationPrefsSchema.optional(),
});
export type MobileDeviceInput = z.input<typeof mobileDeviceInputSchema>;

/** Sent by an installation on its own requests, so a push it caused skips it. */
export const MOBILE_INSTALLATION_HEADER = "x-mobile-installation";

export const mobileInstallationIdSchema = z.uuid();
export type MobileDeviceRegistration = z.infer<typeof mobileDeviceInputSchema>;
