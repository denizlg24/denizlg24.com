import { type NextRequest, NextResponse } from "next/server";
import {
  type CardEntityType,
  linkCardEntity,
  unlinkCardEntity,
} from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

const ENTITY_TYPES = new Set<CardEntityType>([
  "calendar",
  "note",
  "person",
  "course",
]);

async function parseLinkRequest(request: NextRequest) {
  if (request.method === "DELETE") {
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get("entityType") as CardEntityType | null;
    const entityId = searchParams.get("entityId");
    if (entityType && ENTITY_TYPES.has(entityType) && entityId) {
      return { entityType, entityId };
    }
  }
  let body: { entityType?: CardEntityType; entityId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return null;
  }
  if (
    !body.entityType ||
    !ENTITY_TYPES.has(body.entityType) ||
    !body.entityId
  ) {
    return null;
  }
  return { entityType: body.entityType, entityId: body.entityId };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const link = await parseLinkRequest(request);
  if (!link) {
    return NextResponse.json(
      { error: "entityType and entityId are required" },
      { status: 400 },
    );
  }
  const { cardId } = await params;
  const card = await linkCardEntity(cardId, link.entityType, link.entityId);
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  return NextResponse.json({ card }, { status: 200 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string; cardId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const link = await parseLinkRequest(request);
  if (!link) {
    return NextResponse.json(
      { error: "entityType and entityId are required" },
      { status: 400 },
    );
  }
  const { cardId } = await params;
  const card = await unlinkCardEntity(cardId, link.entityType, link.entityId);
  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  return NextResponse.json({ card }, { status: 200 });
}
