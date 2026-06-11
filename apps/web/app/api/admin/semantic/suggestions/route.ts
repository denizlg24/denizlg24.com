import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  isSuggestionStatus,
  isSuggestionType,
  serializeSemanticSuggestion,
} from "@/lib/semantic-route-utils";
import {
  type ILeanKnowledgeSemanticSuggestion,
  KnowledgeSemanticSuggestion,
} from "@/models/KnowledgeSemanticSuggestion";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") ?? "pending";
    const type = searchParams.get("type");
    const filter: Record<string, unknown> = {};

    if (isSuggestionStatus(status)) filter.status = status;
    if (isSuggestionType(type)) filter.type = type;

    const suggestions = await KnowledgeSemanticSuggestion.find(filter)
      .sort({ confidence: -1, createdAt: -1 })
      .limit(500)
      .lean<ILeanKnowledgeSemanticSuggestion[]>()
      .exec();

    return NextResponse.json({
      suggestions: suggestions.map(serializeSemanticSuggestion),
    });
  } catch (error) {
    console.error("Error fetching semantic suggestions:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
