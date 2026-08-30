import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/connection";
import { foodLogDayNotes } from "@/db/schema";
import { getRequiredSession } from "@/lib/api/session";

const dayNoteBodySchema = z.object({
  logDate: z.iso.date(),
  note: z.string().max(2000),
});

export async function PUT(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;

  const parsed = dayNoteBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid note", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { logDate, note } = parsed.data;
  const trimmed = note.trim();

  // An emptied note is a deletion, so the day does not keep a blank row.
  if (!trimmed) {
    await db
      .delete(foodLogDayNotes)
      .where(
        and(
          eq(foodLogDayNotes.userId, session.user.id),
          eq(foodLogDayNotes.logDate, logDate),
        ),
      );
    return NextResponse.json({ note: null });
  }

  await db
    .insert(foodLogDayNotes)
    .values({ userId: session.user.id, logDate, note: trimmed })
    .onConflictDoUpdate({
      target: [foodLogDayNotes.userId, foodLogDayNotes.logDate],
      set: { note: trimmed, updatedAt: new Date() },
    });

  return NextResponse.json({ note: trimmed });
}
