import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createTimetableEntry, getAllTimetableEntries } from "@/lib/timetable";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const entries = await getAllTimetableEntries();
    return NextResponse.json({ entries }, { status: 200 });
  } catch (error) {
    console.error("Error fetching timetable entries:", error);
    return NextResponse.json(
      { error: "Failed to fetch timetable entries" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    if (
      !body.title ||
      body.dayOfWeek === undefined ||
      !body.startTime ||
      !body.endTime
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const entry = await createTimetableEntry(body);
    if (!entry) {
      return NextResponse.json(
        { error: "Failed to create timetable entry" },
        { status: 500 },
      );
    }

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    console.error("Error creating timetable entry:", error);
    return NextResponse.json(
      { error: "Failed to create timetable entry" },
      { status: 500 },
    );
  }
}
