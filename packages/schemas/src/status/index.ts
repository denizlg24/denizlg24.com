import { z } from "zod";

/**
 * Wire contracts for the status page's admin API (`apps/status`,
 * `/api/admin/*`), shared with the MCP server's `status_*` tools. Response
 * shapes stay with the app: the tools pass bodies through untouched.
 */

export const statusHealthSchema = z.enum([
  "operational",
  "degraded",
  "down",
  "unknown",
  "maintenance",
]);
export type StatusHealth = z.infer<typeof statusHealthSchema>;

export const statusIncidentStateSchema = z.enum([
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);
export type StatusIncidentState = z.infer<typeof statusIncidentStateSchema>;

export const statusUpdateVisibilitySchema = z.enum(["public", "private"]);

/**
 * What the triage agent concluded about an automatic incident. `transient`
 * needs nothing further, `operational` was handled with infrastructure tools,
 * `code` means a defect that escalates to a repository issue.
 */
export const statusAgentVerdictSchema = z.enum([
  "transient",
  "operational",
  "code",
]);
export type StatusAgentVerdict = z.infer<typeof statusAgentVerdictSchema>;

const text = z.string().trim().min(1).max(4000);
const serviceIds = z.array(z.string().min(1).max(160)).min(1).max(100);

export const statusIncidentCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  serviceIds,
  text,
});
export type StatusIncidentCreateInput = z.infer<
  typeof statusIncidentCreateInputSchema
>;

export const statusIncidentUpdateInputSchema = z.object({
  text,
  visibility: statusUpdateVisibilitySchema,
  state: statusIncidentStateSchema,
  verdict: statusAgentVerdictSchema.optional(),
});
export type StatusIncidentUpdateInput = z.infer<
  typeof statusIncidentUpdateInputSchema
>;

export const statusIncidentEscalateInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  /** Markdown body of the issue: diagnosis, evidence, suspected files. */
  body: z.string().trim().min(1).max(60_000),
  /** Added to the incident's default labels. */
  labels: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
});
export type StatusIncidentEscalateInput = z.infer<
  typeof statusIncidentEscalateInputSchema
>;

export const statusIncidentListQuerySchema = z.object({
  state: z.enum(["open", "all"]).default("open"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type StatusIncidentListQuery = z.infer<
  typeof statusIncidentListQuerySchema
>;

export const statusMaintenanceRepeatSchema = z.enum(["weekly"]).nullable();
export type StatusMaintenanceRepeat = z.infer<
  typeof statusMaintenanceRepeatSchema
>;

export const statusMaintenanceInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: text,
    serviceIds,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    repeat: statusMaintenanceRepeatSchema.default(null),
  })
  .refine(
    (value) => Date.parse(value.endsAt) > Date.parse(value.startsAt),
    "Maintenance must end after it starts",
  )
  .refine(
    (value) =>
      value.repeat !== "weekly" ||
      Date.parse(value.endsAt) - Date.parse(value.startsAt) < 7 * 86400_000,
    "A weekly window must be shorter than a week",
  );
export type StatusMaintenanceInput = z.infer<
  typeof statusMaintenanceInputSchema
>;

export const statusSamplesQuerySchema = z.object({
  minutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(60),
});
export type StatusSamplesQuery = z.infer<typeof statusSamplesQuerySchema>;
