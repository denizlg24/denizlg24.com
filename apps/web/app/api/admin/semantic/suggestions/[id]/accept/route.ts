import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { serializeSemanticSuggestion } from "@/lib/semantic-route-utils";
import {
  acceptSemanticSuggestion,
  SuggestionNotPendingError,
} from "@/lib/semantic-suggestions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const result = await acceptSemanticSuggestion(id);
    if (!result) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { suggestion, ...applied } = result;
    return NextResponse.json({
      suggestion: suggestion
        ? serializeSemanticSuggestion(suggestion)
        : undefined,
      ...applied,
    });
  } catch (error) {
    if (error instanceof SuggestionNotPendingError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Error accepting semantic suggestion:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
