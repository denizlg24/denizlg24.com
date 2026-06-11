import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { Note } from "@/models/Note";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const tags = (await Note.distinct("tags").exec()).filter(
      (tag): tag is string => typeof tag === "string",
    );
    return NextResponse.json(
      { tags: tags.sort((left, right) => left.localeCompare(right)) },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching note tags:", error);
    return NextResponse.json(
      { error: "Failed to fetch note tags" },
      { status: 500 },
    );
  }
}
