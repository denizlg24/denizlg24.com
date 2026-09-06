"use server";
import { randomUUID } from "node:crypto";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  AccessError,
  cloudRequest,
  requireAdmin,
  requireSameOrigin,
} from "@/lib/auth";
import { betterRequest } from "@/lib/better-stack";
import { collections } from "@/lib/db";
import {
  backupCommandInput,
  incidentInput,
  maintenanceInput,
  updateInput,
} from "@/lib/input";
import type { Incident } from "@/lib/model";

const field = (form: FormData, key: string) => String(form.get(key) ?? "");
const targetId = (form: FormData) =>
  z.string().min(1).max(160).parse(field(form, "id"));
const allowedTypes = new Set([
  "backup_postgres",
  "backup_mongodb",
  "backup_files",
  "backup_all",
]);
export async function adminAction(form: FormData): Promise<void> {
  await requireSameOrigin();
  const actor = await requireAdmin();
  const operation = z
    .enum([
      "incident-create",
      "incident-update",
      "incident-acknowledge",
      "incident-resolve",
      "maintenance-save",
      "maintenance-cancel",
      "backup-run",
      "backup-schedule",
      "dr-command",
    ])
    .parse(field(form, "operation"));
  const view = operation.startsWith("incident")
    ? "incidents"
    : operation.startsWith("maintenance")
      ? "maintenance"
      : "backups";
  const mutationId = z.uuid().parse(field(form, "mutationId"));
  const c = await collections();
  const auditId = `${actor.id}:${mutationId}`;
  let message = "Changes saved.";
  try {
    await c.audit.insertOne({
      _id: auditId,
      at: new Date(),
      actor: actor.username,
      action: operation,
      target: field(form, "id"),
      outcome: "started",
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000
    )
      redirect(
        `/admin?view=${view}&notice=${encodeURIComponent("This request was already submitted. Check the audit log before retrying.")}`,
      );
    throw error;
  }
  try {
    const now = new Date().toISOString();
    const validateServices = async (ids: string[]) => {
      const snapshot = await c.snapshots.findOne({ _id: "latest" });
      if (
        ids.some(
          (id) => !snapshot?.services.some((service) => service.id === id),
        )
      )
        throw new AccessError(
          400,
          "Select services from the latest monitoring report.",
        );
    };
    if (operation === "incident-create") {
      const input = incidentInput.parse({
        title: field(form, "title"),
        text: field(form, "text"),
        serviceIds: form.getAll("serviceIds"),
      });
      await validateServices(input.serviceIds);
      const incident: Incident = {
        _id: `manual:${randomUUID()}`,
        betterStackId: null,
        title: input.title,
        serviceIds: input.serviceIds,
        startedAt: now,
        acknowledgedAt: now,
        resolvedAt: null,
        cause: "Manually reported",
        evidence: [],
        updates: [
          {
            id: randomUUID(),
            at: now,
            author: actor.username,
            visibility: "public",
            state: "investigating",
            text: input.text,
          },
        ],
      };
      await c.incidents.insertOne(incident);
    } else if (operation.startsWith("incident-")) {
      const incident = await c.incidents.findOne({ _id: targetId(form) });
      if (!incident) throw new AccessError(404, "Incident not found.");
      const upstream = incident.betterStackId;
      if (operation === "incident-update") {
        const input = updateInput.parse({
          id: incident._id,
          text: field(form, "text"),
          visibility: field(form, "visibility"),
          state: field(form, "state"),
        });
        if (input.state === "resolved" && !incident.resolvedAt)
          throw new AccessError(
            400,
            "Resolve the incident before posting a resolved update.",
          );
        if (upstream)
          await betterRequest(
            `/api/v2/incidents/${encodeURIComponent(upstream)}/comments`,
            {
              method: "POST",
              body: JSON.stringify({
                content: `[${input.visibility} status-page note · ${input.state}] ${input.text}\n\nBy ${actor.username}`,
              }),
            },
          );
        await c.incidents.updateOne(
          { _id: incident._id },
          {
            $push: {
              updates: {
                id: randomUUID(),
                at: now,
                author: actor.username,
                visibility: input.visibility,
                state: input.state,
                text: input.text,
              },
            },
          },
        );
      } else {
        const resolve = operation === "incident-resolve";
        if (upstream)
          await betterRequest(
            `/api/v3/incidents/${encodeURIComponent(upstream)}/${resolve ? "resolve" : "acknowledge"}`,
            {
              method: "POST",
              body: JSON.stringify(
                resolve
                  ? { resolved_by: actor.username }
                  : { acknowledged_by: actor.username },
              ),
            },
          );
        await c.incidents.updateOne(
          { _id: incident._id },
          { $set: resolve ? { resolvedAt: now } : { acknowledgedAt: now } },
        );
        message = resolve
          ? "Incident resolved. Monitoring observations remain independent."
          : "Incident acknowledged.";
      }
    } else if (operation === "maintenance-save") {
      const input = maintenanceInput.parse({
        id: field(form, "id"),
        title: field(form, "title"),
        description: field(form, "description"),
        serviceIds: form.getAll("serviceIds"),
        startsAt: `${field(form, "startsAt")}:00.000Z`,
        endsAt: `${field(form, "endsAt")}:00.000Z`,
      });
      await validateServices(input.serviceIds);
      const { id, ...data } = input;
      if (id && !(await c.maintenance.findOne({ _id: id })))
        throw new AccessError(404, "Maintenance window not found.");
      await c.maintenance.updateOne(
        { _id: id || randomUUID() },
        { $set: { ...data, author: actor.username, cancelledAt: null } },
        { upsert: !id },
      );
    } else if (operation === "maintenance-cancel") {
      await c.maintenance.updateOne(
        { _id: targetId(form) },
        { $set: { cancelledAt: now } },
      );
    } else if (operation === "backup-run" || operation === "backup-schedule") {
      const id = z.uuid().parse(targetId(form));
      const task = z
        .object({ data: z.object({ type: z.string() }) })
        .parse(await cloudRequest(`/api/ops/tasks/${id}`));
      if (!allowedTypes.has(task.data.type))
        throw new AccessError(403, "Only backup tasks can be changed here.");
      if (operation === "backup-run") {
        await cloudRequest(`/api/ops/tasks/${id}/run`, { method: "POST" });
        message =
          "Backup accepted by Cloud. Its next report will show progress.";
      } else {
        const cronExpression = z
          .string()
          .trim()
          .min(1)
          .max(100)
          .parse(field(form, "schedule"));
        await cloudRequest(`/api/ops/tasks/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            cronExpression,
            enabled: field(form, "enabled") === "true",
          }),
        });
      }
    } else if (operation === "dr-command") {
      const action = field(form, "action");
      const input = backupCommandInput.parse({
        profile: field(form, "profile"),
        job: field(form, "job"),
        action,
        schedule: action === "schedule" ? field(form, "schedule") : null,
        enabled:
          action === "schedule" ? field(form, "enabled") === "true" : null,
      });
      await c.commands.insertOne({
        _id: randomUUID(),
        ...input,
        state: "queued",
        createdAt: new Date(),
        claimedAt: null,
        completedAt: null,
        actor: actor.username,
        detail: null,
      });
      message =
        "Command queued for the host agent. The audit and command history will show the result.";
    }
    await c.audit.updateOne(
      { _id: auditId },
      { $set: { outcome: "completed" } },
    );
    updateTag("status-public");
  } catch (error) {
    message =
      error instanceof AccessError
        ? error.message
        : error instanceof z.ZodError
          ? "Invalid input. Check required fields, dates, and schedule format."
          : error instanceof Error && error.message.startsWith("Better Stack")
            ? error.message
            : "The operation failed. Check the audit log and service connectivity before retrying.";
    await c.audit.updateOne(
      { _id: auditId },
      { $set: { outcome: `failed: ${message}` } },
    );
  }
  redirect(`/admin?view=${view}&notice=${encodeURIComponent(message)}`);
}
