import { NextResponse } from "next/server";
import { WorkHoursError } from "@/lib/work-hours";

/** Maps a tracker refusal to its status; anything else is a 500. */
export function hoursErrorResponse(error: unknown, fallback: string) {
  if (error instanceof WorkHoursError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  console.error(`[hours] ${fallback}`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
