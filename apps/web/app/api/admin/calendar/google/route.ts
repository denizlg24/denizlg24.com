import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { CalendarExternalConnection } from "@/models/CalendarExternalConnection";
import { CalendarExternalEventSync } from "@/models/CalendarExternalEventSync";

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  calendarId: z.string().trim().min(1).max(255).optional(),
});

function iso(date: Date | undefined) {
  return date ? date.toISOString() : undefined;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const connection = await CalendarExternalConnection.findOne({
    provider: "google",
  }).lean();
  const [pendingSyncCount, failedSyncCount] = await Promise.all([
    CalendarExternalEventSync.countDocuments({
      provider: "google",
      pendingAction: { $in: ["upsert", "delete"] },
    }),
    CalendarExternalEventSync.countDocuments({
      provider: "google",
      lastError: { $exists: true, $ne: "" },
    }),
  ]);

  if (!connection) {
    return NextResponse.json(
      {
        connected: false,
        enabled: false,
        calendarId: "primary",
        scope: [],
        pendingSyncCount,
        failedSyncCount,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      connected: true,
      enabled: connection.enabled,
      calendarId: connection.calendarId,
      accountEmail: connection.accountEmail,
      scope: connection.scope,
      connectedAt: iso(connection.connectedAt),
      updatedAt: iso(connection.updatedAt),
      lastSyncAt: iso(connection.lastSyncAt),
      lastSyncError: connection.lastSyncError,
      needsReauth: connection.needsReauth ?? false,
      pendingSyncCount,
      failedSyncCount,
    },
    { status: 200 },
  );
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid Google Calendar settings" },
      { status: 400 },
    );
  }

  await connectDB();
  const update: Record<string, unknown> = {};
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;
  if (parsed.data.calendarId !== undefined) {
    update.calendarId = parsed.data.calendarId;
  }

  const connection = await CalendarExternalConnection.findOneAndUpdate(
    { provider: "google" },
    { $set: update },
    { returnDocument: "after" },
  ).lean();

  if (!connection) {
    return NextResponse.json(
      { error: "Google Calendar is not connected" },
      { status: 404 },
    );
  }

  return NextResponse.json(
    {
      connected: true,
      enabled: connection.enabled,
      calendarId: connection.calendarId,
      accountEmail: connection.accountEmail,
      scope: connection.scope,
      connectedAt: iso(connection.connectedAt),
      updatedAt: iso(connection.updatedAt),
      lastSyncAt: iso(connection.lastSyncAt),
      lastSyncError: connection.lastSyncError,
      needsReauth: connection.needsReauth ?? false,
    },
    { status: 200 },
  );
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  await Promise.all([
    CalendarExternalConnection.deleteOne({ provider: "google" }),
    CalendarExternalEventSync.deleteMany({ provider: "google" }),
  ]);

  return NextResponse.json({ success: true }, { status: 200 });
}
