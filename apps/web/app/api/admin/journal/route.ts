import { type NextRequest, NextResponse } from "next/server";
import { createJournal, getJournalLogs } from "@/lib/journal";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  const startDate = startParam ? new Date(startParam) : undefined;
  const endDate = endParam ? new Date(endParam) : undefined;

  const journals = await getJournalLogs(startDate, endDate);
  return NextResponse.json({ journals }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  if (!body.date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  const journal = await createJournal({
    date: new Date(body.date),
    content: body.content,
  });
  if (!journal) {
    return NextResponse.json(
      { error: "Failed to create journal" },
      { status: 500 },
    );
  }

  return NextResponse.json({ journal }, { status: 201 });
}
