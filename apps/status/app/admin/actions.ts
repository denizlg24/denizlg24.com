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
import { betterList, betterRequest, textAttribute } from "@/lib/better-stack";
import { catalog } from "@/lib/catalog";
import { resolveServices, type SourceKind } from "@/lib/config";
import { collections, statusConfig } from "@/lib/db";
import {
  backupCommandInput,
  bindingInput,
  historyResetInput,
  incidentInput,
  maintenanceInput,
  serviceConfigInput,
  serviceMoveInput,
  sourceIdInput,
  updateInput,
} from "@/lib/input";
import type { Incident, Service } from "@/lib/model";

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
      "config-service",
      "config-service-move",
      "config-binding",
      "config-source-forget",
      "sources-refresh",
      "history-reset",
    ])
    .parse(field(form, "operation"));
  const view = operation.startsWith("incident")
    ? "incidents"
    : operation.startsWith("maintenance")
      ? "maintenance"
      : operation === "history-reset"
        ? "overview"
        : operation.startsWith("config-service")
          ? "services"
          : operation === "config-binding" ||
              operation === "config-source-forget" ||
              operation === "sources-refresh"
            ? "sources"
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
    // Only what the page actually shows can be named by an incident or a
    // maintenance window; a hidden tile would announce impact nobody can see.
    const visibleServices = async (): Promise<Service[]> => {
      const [snapshot, config] = await Promise.all([
        c.snapshots.findOne({ _id: "latest" }),
        statusConfig(),
      ]);
      return resolveServices(snapshot?.services ?? catalog, config);
    };
    const validateServices = async (ids: string[]) => {
      const services = await visibleServices();
      if (ids.some((id) => !services.some((service) => service.id === id)))
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
    } else if (operation === "config-service") {
      const input = serviceConfigInput.parse({
        id: field(form, "id"),
        visible: field(form, "visible") === "true",
        name: field(form, "name"),
        description: field(form, "description"),
        group: field(form, "group"),
      });
      const { id, ...override } = input;
      await c.config.updateOne(
        { _id: "config" },
        {
          $set: {
            [`services.${id}`]: override,
            updatedAt: now,
            updatedBy: actor.username,
          },
        },
        { upsert: true },
      );
      message = input.visible
        ? `${input.name || id} is shown on the status page.`
        : `${input.name || id} is hidden from the status page.`;
    } else if (operation === "config-service-move") {
      const input = serviceMoveInput.parse({
        id: field(form, "id"),
        direction: field(form, "direction"),
      });
      const services = await visibleServices();
      const target = services.find((service) => service.id === input.id);
      if (!target) throw new AccessError(404, "Service not found.");
      // Reordering is only meaningful inside a group, and writing explicit ranks
      // for the whole group is what makes the next move deterministic — an
      // implicit catalog rank cannot be swapped against a stored one.
      const peers = services.filter(
        (service) => service.group === target.group,
      );
      const from = peers.findIndex((service) => service.id === input.id);
      const to = from + (input.direction === "up" ? -1 : 1);
      if (to < 0 || to >= peers.length)
        throw new AccessError(400, "The service is already at that end.");
      const reordered = [...peers];
      [reordered[from], reordered[to]] = [reordered[to]!, reordered[from]!];
      const config = await statusConfig();
      await c.config.updateOne(
        { _id: "config" },
        {
          $set: {
            ...Object.fromEntries(
              reordered.map((service, index) => [
                `services.${service.id}`,
                { ...config.services[service.id], order: index },
              ]),
            ),
            updatedAt: now,
            updatedBy: actor.username,
          },
        },
        { upsert: true },
      );
      message = `${target.name} moved ${input.direction}.`;
    } else if (operation === "config-binding") {
      const id = sourceIdInput.parse(field(form, "id"));
      const kind = field(form, "kind");
      const binding = bindingInput.parse(
        kind === "service"
          ? { kind, serviceId: field(form, "serviceId") }
          : kind === "own"
            ? {
                kind,
                name: field(form, "name"),
                group: field(form, "group"),
                description: field(form, "description"),
              }
            : { kind: "ignore" },
      );
      if (binding.kind === "service") {
        const services = await visibleServices();
        if (!services.some((service) => service.id === binding.serviceId))
          throw new AccessError(400, "Choose a service that is on the page.");
      }
      await c.config.updateOne(
        { _id: "config" },
        {
          $set: {
            [`bindings.${id}`]: binding,
            updatedAt: now,
            updatedBy: actor.username,
          },
        },
        { upsert: true },
      );
      message =
        binding.kind === "ignore"
          ? "Source ignored. It will leave the page on the next collection."
          : binding.kind === "service"
            ? `Source now reports into ${binding.serviceId}.`
            : `Source now has its own tile, "${binding.name}".`;
    } else if (operation === "config-source-forget") {
      const id = sourceIdInput.parse(field(form, "id"));
      await c.sources.deleteOne({ _id: id });
      await c.config.updateOne(
        { _id: "config" },
        {
          $unset: { [`bindings.${id}`]: "", [`services.${id}`]: "" },
          $set: { updatedAt: now, updatedBy: actor.username },
        },
      );
      message = "Source forgotten. It returns to the list if it is seen again.";
    } else if (operation === "sources-refresh") {
      const seenAt = now;
      const found: string[] = [];
      for (const [kind, path] of [
        ["monitor", "/api/v2/monitors?per_page=50"],
        ["heartbeat", "/api/v2/heartbeats?per_page=50"],
      ] as const satisfies readonly (readonly [SourceKind, string])[]) {
        for (const item of await betterList(path)) {
          if (!/^\d+$/.test(item.id)) continue;
          const _id = `${kind}:${item.id}`;
          found.push(_id);
          await c.sources.updateOne(
            { _id },
            {
              $set: {
                kind,
                externalId: item.id,
                name:
                  textAttribute(item, "pronounceable_name") ??
                  textAttribute(item, "name") ??
                  _id,
                url: textAttribute(item, "url"),
                monitorType: textAttribute(item, "monitor_type"),
                upstreamStatus: textAttribute(item, "status"),
                lastCheckedAt:
                  textAttribute(item, "last_checked_at") ??
                  textAttribute(item, "last_ping_at"),
                lastSeenAt: seenAt,
                missingSince: null,
              },
            },
            { upsert: true },
          );
        }
      }
      await c.sources.updateMany(
        { _id: { $nin: found }, missingSince: null },
        { $set: { missingSince: seenAt } },
      );
      message = `${found.length} Better Stack source${found.length === 1 ? "" : "s"} found.`;
    } else if (operation === "history-reset") {
      const input = historyResetInput.parse({
        scope: field(form, "scope"),
        confirm: field(form, "confirm"),
      });
      // Uptime is derived from these three and nothing else, so clearing them
      // is what makes the published percentages start from the launch date
      // rather than from whatever was measured while the page was being built.
      const cleared = await Promise.all([
        c.samples.deleteMany({}),
        c.daily.deleteMany({}),
        c.timings.deleteMany({}),
      ]);
      let removed = cleared.reduce(
        (sum, result) => sum + result.deletedCount,
        0,
      );
      if (input.scope === "history-and-incidents") {
        const incidents = await c.incidents.deleteMany({});
        const maintenance = await c.maintenance.deleteMany({});
        removed += incidents.deletedCount + maintenance.deletedCount;
      }
      // The snapshot is left in place: it is the current reading, not history,
      // and dropping it would blank the page until the next collection.
      message = `Cleared ${removed.toLocaleString()} record${removed === 1 ? "" : "s"}. Uptime is measured from now on.`;
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
