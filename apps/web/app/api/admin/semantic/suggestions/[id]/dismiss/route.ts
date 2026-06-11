import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { serializeSemanticSuggestion } from "@/lib/semantic-route-utils";
import {
  type ILeanKnowledgeSemanticSuggestion,
  KnowledgeSemanticSuggestion,
} from "@/models/KnowledgeSemanticSuggestion";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    await connectDB();
    const suggestion = await KnowledgeSemanticSuggestion.findByIdAndUpdate(
      id,
      { $set: { status: "dismissed", decidedAt: new Date() } },
      { new: true },
    )
      .lean<ILeanKnowledgeSemanticSuggestion>()
      .exec();

    if (!suggestion) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      suggestion: serializeSemanticSuggestion(suggestion),
    });
  } catch (error) {
    console.error("Error dismissing semantic suggestion:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
