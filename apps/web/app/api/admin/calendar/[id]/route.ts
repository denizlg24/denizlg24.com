import { after, type NextRequest, NextResponse } from "next/server";
import {
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/lib/calendar-events";
import {
  isGoogleOutboundSyncableKind,
  syncEventToGoogle,
} from "@/lib/google-calendar-sync";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();

  const updated = await updateCalendarEvent({ id, data: body });
  if (!updated) {
    return NextResponse.json(
      { error: "Failed to update calendar event" },
      { status: 500 },
    );
  }
  if (isGoogleOutboundSyncableKind(updated.kind)) {
    after(() =>
      syncEventToGoogle(updated._id, "upsert").catch((error) => {
        console.error("Failed to sync calendar event to Google:", error);
      }),
    );
  }
  return NextResponse.json({ event: updated }, { status: 200 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;

  const deleted = await deleteCalendarEvent(id);
  if (!deleted) {
    return NextResponse.json(
      { error: "Failed to delete calendar event" },
      { status: 500 },
    );
  }
  after(() =>
    syncEventToGoogle(id, "delete").catch((error) => {
      console.error("Failed to delete Google Calendar event mirror:", error);
    }),
  );
  return NextResponse.json({ success: true }, { status: 200 });
}
