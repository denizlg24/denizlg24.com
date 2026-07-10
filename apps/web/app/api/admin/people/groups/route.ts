import { type NextRequest, NextResponse } from "next/server";
import { createPersonGroup, listPersonGroups } from "@/lib/people";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    return NextResponse.json({ groups: await listPersonGroups() });
  } catch (error) {
    console.error("Error fetching person groups:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    const group = await createPersonGroup(body);
    if (!group) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    return NextResponse.json({ group }, { status: 201 });
  } catch (error) {
    console.error("Error creating person group:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed" },
      { status: 500 },
    );
  }
}
