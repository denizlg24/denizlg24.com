import { type NextRequest, NextResponse } from "next/server";
import { knowledgeCoverage } from "@/lib/knowledge/status";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    return NextResponse.json(await knowledgeCoverage(), { status: 200 });
  } catch (error) {
    console.error("Failed to read knowledge coverage:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
