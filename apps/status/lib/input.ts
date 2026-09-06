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
const serviceId = z.string().trim().min(1).max(160);
export const serviceConfigInput = z.object({
  id: serviceId,
  visible: z.boolean(),
  name: z.string().trim().max(80),
  description: z.string().trim().max(400),
  group: z.string().trim().max(60),
});
export const serviceMoveInput = z.object({
  id: serviceId,
  direction: z.enum(["up", "down"]),
});
// A source key, not a free identifier: the collector only ever writes
// "monitor:<digits>" or "heartbeat:<digits>", and a binding for anything else
// could never be resolved.
export const sourceIdInput = z
  .string()
  .trim()
  .regex(/^(?:monitor|heartbeat):\d{1,32}$/);
export const bindingInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ignore") }),
  z.object({ kind: z.literal("service"), serviceId }),
  z.object({
    kind: z.literal("own"),
    name: z.string().trim().min(1).max(80),
    group: z.string().trim().min(1).max(60),
    description: z.string().trim().max(400),
  }),
]);
// Clearing history is the one irreversible operation here, so it is not a bare
// button: the phrase has to be typed, exactly, in the same submission.
export const RESET_PHRASE = "RESET";
export const historyResetInput = z.object({
  scope: z.enum(["history", "history-and-incidents"]),
  confirm: z.literal(RESET_PHRASE),
});
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
