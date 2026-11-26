import { type NextRequest, NextResponse } from "next/server";
import { completeCard, NoDoneColumnError } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { cardId } = await params;
    const card = await completeCard(cardId);
    if (!card)
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    return NextResponse.json({ card }, { status: 200 });
  } catch (error) {
    if (error instanceof NoDoneColumnError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json(
      { error: "Failed to complete card" },
      { status: 500 },
    );
  }
}
