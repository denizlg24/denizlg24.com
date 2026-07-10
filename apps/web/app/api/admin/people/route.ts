import { type NextRequest, NextResponse } from "next/server";
import {
  createPerson,
  getPeopleGraph,
  getPersonEdges,
  listPersonGroups,
} from "@/lib/people";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    return NextResponse.json(await getPeopleGraph());
  } catch (error) {
    console.error("Error fetching people:", error);
    return NextResponse.json(
      { error: "Failed to fetch people" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    const person = await createPerson(body);
    if (!person) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    const [groups, edges] = await Promise.all([
      listPersonGroups(),
      getPersonEdges(person._id),
    ]);

    return NextResponse.json({ person, groups, edges }, { status: 201 });
  } catch (error) {
    console.error("Error creating person:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to create person" },
      { status: 500 },
    );
  }
}
