import { type NextRequest, NextResponse } from "next/server";
import { createConversation, getAllConversations } from "@/lib/conversations";
import { requireAdmin } from "@/lib/require-admin";

const DEFAULT_CONVERSATION_LIMIT = 90;
const MAX_CONVERSATION_LIMIT = 300;

function parseOffset(value: string | null): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? DEFAULT_CONVERSATION_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_CONVERSATION_LIMIT;
  return Math.min(Math.max(1, Math.trunc(parsed)), MAX_CONVERSATION_LIMIT);
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const result = await getAllConversations({
      offset: parseOffset(searchParams.get("offset")),
      limit: parseLimit(searchParams.get("limit")),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch conversations" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { title, model: llmModel } = body;

    if (!title || !llmModel) {
      return NextResponse.json(
        { error: "title and model are required" },
        { status: 400 },
      );
    }

    const conversation = await createConversation({ title, llmModel });
    return NextResponse.json({ conversation }, { status: 201 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  }
}
