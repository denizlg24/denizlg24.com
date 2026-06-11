import { type NextRequest, NextResponse } from "next/server";
import {
  createCalendarEvent,
  getCalendarEvents,
  getMonthCalendarEvents,
} from "@/lib/calendar-events";
import { ensureGeneratedCalendarEventsForRange } from "@/lib/calendar-sync";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  const created = await createCalendarEvent(body);
  if (!created) {
    return NextResponse.json(
      { error: "Failed to create calendar event" },
      { status: 500 },
    );
  }
  return NextResponse.json({ event: created }, { status: 200 });
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  if (dateParam) {
    const date = new Date(dateParam);
    await ensureGeneratedCalendarEventsForRange(date, date);
    const events = await getCalendarEvents(date);
    return NextResponse.json({ events }, { status: 200 });
  }

  if (startParam && endParam) {
    const start = new Date(startParam);
    const end = new Date(endParam);
    await ensureGeneratedCalendarEventsForRange(start, end);
    const events = await getMonthCalendarEvents(start, end);
    return NextResponse.json({ events }, { status: 200 });
  }

  return NextResponse.json(
    {
      error: "Either 'date' or both 'start' and 'end' parameters are required",
    },
    { status: 400 },
  );
}
