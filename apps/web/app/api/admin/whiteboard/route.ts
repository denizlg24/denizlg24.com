import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { createWhiteboard, getAllWhiteboards } from "@/lib/whiteboard";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const whiteboards = await getAllWhiteboards();
  return NextResponse.json({ whiteboards }, { status: 200 });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const body = await request.json();
  if (!body.name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const whiteboard = await createWhiteboard({ name: body.name });
  if (!whiteboard) {
    return NextResponse.json(
      { error: "Failed to create whiteboard" },
      { status: 500 },
    );
  }

  return NextResponse.json({ whiteboard }, { status: 201 });
}
