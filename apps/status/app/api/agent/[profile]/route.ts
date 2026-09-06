import { revalidateTag } from "next/cache";
import { z } from "zod";
import { validBearer } from "@/lib/auth";
import { drJobs } from "@/lib/catalog";
import { backupReportSchema } from "@/lib/contracts";
import { collections } from "@/lib/db";
import type { Backup } from "@/lib/model";

const profileSchema = z.enum(["pi", "forge", "mac"]);
const envelope = z.discriminatedUnion("type", [
  z.object({ type: z.literal("report"), report: backupReportSchema }),
  z.object({ type: z.literal("claim") }),
  z.object({
    type: z.literal("result"),
    id: z.uuid(),
    success: z.boolean(),
    detail: z.string().max(2000),
  }),
]);
export async function POST(
  request: Request,
  context: { params: Promise<{ profile: string }> },
) {
  const profile = profileSchema.safeParse((await context.params).profile);
  if (
    !profile.success ||
    !validBearer(
      request.headers.get("authorization"),
      process.env[`STATUS_AGENT_${profile.data.toUpperCase()}_TOKEN`],
    )
  )
    return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 32_768)
    return new Response("Too large", { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response("Invalid body", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 32_768) {
      await reader.cancel();
      return new Response("Too large", { status: 413 });
    }
    chunks.push(next.value);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return new Response("Invalid report", { status: 400 });
  const c = await collections();
  const now = new Date();
  if (parsed.data.type === "claim") {
    // Expired/abandoned commands are never replayed automatically: a lost
    // acknowledgement must not trigger the same backup or schedule twice.
    await c.commands.updateMany(
      {
        profile: profile.data,
        state: "queued",
        createdAt: { $lt: new Date(Date.now() - 3600_000) },
      },
      {
        $set: {
          state: "failed",
          completedAt: now,
          detail: "Command expired before the host accepted it.",
        },
      },
    );
    await c.commands.updateMany(
      {
        profile: profile.data,
        state: "claimed",
        claimedAt: { $lt: new Date(Date.now() - 600_000) },
      },
      {
        $set: {
          state: "failed",
          completedAt: now,
          detail:
            "Host acknowledgement timed out. Check the host before retrying.",
        },
      },
    );
    const command = await c.commands.findOneAndUpdate(
      { profile: profile.data, state: "queued" },
      { $set: { state: "claimed", claimedAt: now } },
      { sort: { createdAt: 1 }, returnDocument: "after" },
    );
    return Response.json(
      {
        command: command
          ? {
              id: command._id,
              job: command.job,
              action: command.action,
              schedule: command.schedule,
              enabled: command.enabled,
            }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (parsed.data.type === "result") {
    const result = await c.commands.updateOne(
      { _id: parsed.data.id, profile: profile.data, state: "claimed" },
      {
        $set: {
          state: parsed.data.success ? "completed" : "failed",
          completedAt: now,
          detail: parsed.data.detail,
        },
      },
    );
    return Response.json({ accepted: result.matchedCount === 1 });
  }
  const report = parsed.data.report;
  const definition = drJobs.find(
    (job) => job.profile === profile.data && job.job === report.job,
  );
  if (
    !definition ||
    Date.parse(report.startedAt) > now.getTime() + 60_000 ||
    (report.completedAt &&
      Date.parse(report.completedAt) > now.getTime() + 60_000)
  )
    return new Response("Invalid job or timestamp", { status: 400 });
  const backup: Backup & { _id: string } = {
    ...report,
    ...definition,
    _id: definition.id,
    provider: "dr",
    reportedAt: now.toISOString(),
  };
  // Only replace with an equally new or newer run; a delayed completion from
  // the previous run cannot overwrite the currently running backup.
  const previous = await c.backups.findOne({ _id: backup._id });
  if (
    !previous?.startedAt ||
    Date.parse(previous.startedAt) <= Date.parse(report.startedAt)
  ) {
    if (
      previous?.runId === report.runId &&
      ["completed", "failed"].includes(previous.status) &&
      report.status === "running"
    )
      return Response.json({ accepted: false });
    backup.lastSuccessAt =
      report.lastSuccessAt ?? previous?.lastSuccessAt ?? null;
    // Compare-and-swap prevents a concurrent newer report from being replaced.
    try {
      const updated = await c.backups.replaceOne(
        previous
          ? {
              _id: backup._id,
              reportedAt: previous.reportedAt,
              runId: previous.runId,
            }
          : { _id: backup._id },
        backup,
        { upsert: !previous },
      );
      if (previous && !updated.matchedCount)
        return Response.json({ accepted: false });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      )
        return Response.json({ accepted: false });
      throw error;
    }
  }
  await c.backupRuns.updateOne(
    { _id: `${definition.id}:${report.runId}` },
    {
      $set: {
        ...backup,
        _id: `${definition.id}:${report.runId}`,
        expiresAt: new Date(Date.parse(report.startedAt) + 91 * 86400_000),
      },
    },
    { upsert: true },
  );
  revalidateTag("status-public", { expire: 0 });
  return Response.json({ accepted: true });
}
