import { z } from "zod";

const text = z.string().trim().min(1).max(4000);
const ids = z.array(z.string().min(1).max(160)).min(1).max(100);
export const incidentInput = z.object({
  title: z.string().trim().min(1).max(160),
  serviceIds: ids,
  text,
});
export const updateInput = z.object({
  id: z.string().min(1).max(160),
  text,
  visibility: z.enum(["public", "private"]),
  state: z.enum(["investigating", "identified", "monitoring", "resolved"]),
});
export const maintenanceInput = z
  .object({
    id: z.string().max(160),
    title: z.string().trim().min(1).max(160),
    description: text,
    serviceIds: ids,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
  })
  .refine(
    (value) => Date.parse(value.endsAt) > Date.parse(value.startsAt),
    "Maintenance must end after it starts",
  );
// Systemd calendar expressions are validated again by systemd-analyze on the
// host. Newlines/control characters can never become drop-in directives.
export const calendarInput = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9*,:/ .+~_-]+$/);
export const backupCommandInput = z
  .object({
    profile: z.enum(["pi", "forge", "mac"]),
    job: z.enum(["backup", "r2-sync", "r2-retention", "icloud"]),
    action: z.enum(["run", "schedule"]),
    schedule: calendarInput.nullable(),
    enabled: z.boolean().nullable(),
  })
  .superRefine((value, context) => {
    if ((value.profile === "mac") !== (value.job === "icloud"))
      context.addIssue({
        code: "custom",
        message: "Job does not belong to this host",
      });
    if (
      value.action === "schedule" &&
      (value.schedule === null || value.enabled === null)
    )
      context.addIssue({
        code: "custom",
        message: "Schedule and enabled state are required",
      });
    if (
      value.action === "schedule" &&
      value.profile === "mac" &&
      !/^\d+$/.test(value.schedule ?? "")
    )
      context.addIssue({
        code: "custom",
        message: "iCloud schedule is an interval in seconds",
      });
  });
