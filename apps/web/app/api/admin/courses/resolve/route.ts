import { type NextRequest, NextResponse } from "next/server";
import { resolveCourses } from "@/lib/courses";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }
  return NextResponse.json({ matches: await resolveCourses(q) });
}
