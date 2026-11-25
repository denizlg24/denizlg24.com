import { type NextRequest, NextResponse } from "next/server";
import { getCardById } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { cardId } = await params;
    const card = await getCardById(cardId);
    if (!card)
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    return NextResponse.json({ card }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to fetch card" },
      { status: 500 },
    );
  }
}
