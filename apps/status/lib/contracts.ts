import { z } from "zod";

const date = z.iso.datetime({ offset: true });
const check = z.object({
  status: z.enum(["ok", "down", "degraded", "unknown"]),
  latencyMs: z.number().finite().nonnegative().nullable(),
  message: z.string().nullish(),
  error: z.string().nullish(),
});
const health = z
  .object({ timestamp: date, checks: z.record(z.string(), check) })
  .nullable();
const run = z.object({
  id: z.string(),
  taskId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  startedAt: date.nullable(),
  completedAt: date.nullable(),
  createdAt: date,
  output: z.string().nullable(),
  error: z.string().nullable(),
  metadata: z
    .object({
      durationMs: z.number().optional(),
      backupSizeBytes: z.number().optional(),
      backupPath: z.string().optional(),
    })
    .nullable(),
});
export const monitoringSchema = z.object({
  timestamp: date,
  health,
  deep: health,
  extra: health.optional(),
  backups: z
    .object({
      tasks: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          type: z.string(),
          enabled: z.boolean(),
          cronExpression: z.string().nullable(),
          nextRunAt: date.nullable(),
        }),
      ),
      runs: z.array(run),
      successes: z.array(run),
    })
    .nullable(),
});
export const backupReportSchema = z
  .object({
    job: z.enum(["backup", "r2-sync", "r2-retention", "icloud"]),
    runId: z.string().min(1).max(160),
    status: z.enum(["pending", "running", "completed", "failed"]),
    startedAt: date,
    completedAt: date.nullable(),
    lastSuccessAt: date.nullable(),
    nextRunAt: date.nullable(),
    durationMs: z.number().finite().nonnegative().nullable(),
    sizeBytes: z.number().finite().nonnegative().nullable(),
    enabled: z.boolean(),
    schedule: z.string().max(200).nullable(),
    detail: z.string().max(8000).nullable(),
    verification: z.string().max(2000).nullable(),
  })
  .strict()
  .superRefine((report, context) => {
    const terminal = ["completed", "failed"].includes(report.status);
    if (terminal !== (report.completedAt !== null))
      context.addIssue({
        code: "custom",
        message: "Completion timestamp must match run state",
      });
    if (
      report.completedAt &&
      Date.parse(report.completedAt) < Date.parse(report.startedAt)
    )
      context.addIssue({
        code: "custom",
        message: "Completion precedes start",
      });
  });
