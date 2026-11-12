import { parseKnowledgeSourceKey } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { serializeChunk } from "@/lib/knowledge/serialize";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  type ILeanKnowledgeChunk,
  KnowledgeChunk,
} from "@/models/KnowledgeChunk";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { key } = await params;
  const sourceKey = decodeURIComponent(key);
  if (!parseKnowledgeSourceKey(sourceKey)) {
    return NextResponse.json({ error: "Invalid source key" }, { status: 400 });
  }
  try {
    await connectDB();
    const chunks = await KnowledgeChunk.find({ sourceKey })
      .select("-vector -text")
      .sort({ ordinal: 1 })
      .lean<ILeanKnowledgeChunk[]>()
      .exec();
    return NextResponse.json(
      { chunks: chunks.map(serializeChunk) },
      { status: 200 },
    );
  } catch (error) {
    console.error("Failed to list chunks:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
