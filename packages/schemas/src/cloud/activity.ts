import { z } from "zod";

import { cloudDateTimeSchema } from "./common";

export const ACTIVITY_CATEGORIES = [
  "auth",
  "storage",
  "s3",
  "projects",
  "database",
  "ops",
  "tasks",
  "terminal",
  "admin",
  "system",
  // Appended rather than slotted next to "storage": the Postgres enum is
  // altered in place, and only appending avoids recreating the type.
  "dav",
] as const;
export const activityCategorySchema = z.enum(ACTIVITY_CATEGORIES);
export type ActivityCategory = z.infer<typeof activityCategorySchema>;

export const ACTIVITY_SEVERITIES = ["info", "warn", "error"] as const;
export const activitySeveritySchema = z.enum(ACTIVITY_SEVERITIES);
export type ActivitySeverity = z.infer<typeof activitySeveritySchema>;

export const ACTIVITY_ACTOR_TYPES = [
  "user",
  "api_key",
  "s3_credential",
  "share",
  "system",
  "anonymous",
] as const;
export const activityActorTypeSchema = z.enum(ACTIVITY_ACTOR_TYPES);
export type ActivityActorType = z.infer<typeof activityActorTypeSchema>;

export const activityMetadataSchema = z.record(z.string(), z.unknown());
export type ActivityMetadata = z.infer<typeof activityMetadataSchema>;

/**
 * Actions that something other than the recorder queries by name. Free-form
 * strings stay allowed — these are only the ones with a reader.
 */
export const ACTIVITY_ACTIONS = {
  httpRequest: "http.request",
  signInFailed: "auth.sign_in_failed",
} as const;

export const safeActivityEntrySchema = z.object({
  id: z.uuid(),
  ts: cloudDateTimeSchema,
  category: activityCategorySchema,
  severity: activitySeveritySchema,
  action: z.string(),
  actorType: activityActorTypeSchema,
  actorId: z.string().nullable(),
  actorLabel: z.string().nullable(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  statusCode: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  message: z.string().nullable(),
  metadata: activityMetadataSchema.nullable(),
});
export type SafeActivityEntry = z.infer<typeof safeActivityEntrySchema>;

/**
 * Status buckets rather than raw codes — the panel filters by "what went wrong",
 * and an exact-code filter is the free-text search's job.
 */
export const activityStatusClassSchema = z.enum([
  "success",
  "client_error",
  "server_error",
]);
export type ActivityStatusClass = z.infer<typeof activityStatusClassSchema>;

export const ACTIVITY_QUERY_MAX_LIMIT = 200;

export const activityQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(ACTIVITY_QUERY_MAX_LIMIT)
      .default(50),
    category: z.array(activityCategorySchema).optional(),
    severity: z.array(activitySeveritySchema).optional(),
    statusClass: activityStatusClassSchema.optional(),
    action: z.string().min(1).max(128).optional(),
    actorId: z.string().min(1).max(255).optional(),
    from: cloudDateTimeSchema.optional(),
    to: cloudDateTimeSchema.optional(),
    q: z.string().min(1).max(255).optional(),
  })
  .refine(
    ({ from, to }) =>
      !from || !to || new Date(from).getTime() <= new Date(to).getTime(),
    { path: ["from"], message: "from must not be later than to" },
  );
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

const facetCountSchema = z.object({
  value: z.string(),
  count: z.number().int().nonnegative(),
});

export const activityFacetsSchema = z.object({
  categories: z.array(facetCountSchema),
  actions: z.array(facetCountSchema),
  actors: z.array(
    z.object({
      id: z.string(),
      label: z.string().nullable(),
      count: z.number().int().nonnegative(),
    }),
  ),
  oldestAt: cloudDateTimeSchema.nullable(),
});
export type ActivityFacets = z.infer<typeof activityFacetsSchema>;
