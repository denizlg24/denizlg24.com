import { type NextRequest, NextResponse } from "next/server";
import { NoCvDraftError, publishCvDraft } from "@/lib/cv-project";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    return NextResponse.json(await publishCvDraft());
  } catch (error) {
    if (error instanceof NoCvDraftError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("CV publish failed", error);
    return NextResponse.json(
      { error: "Failed to publish CV" },
      { status: 500 },
    );
  }
}
