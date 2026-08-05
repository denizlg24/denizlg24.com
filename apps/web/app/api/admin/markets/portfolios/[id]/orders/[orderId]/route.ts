import { orderAmendSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { amendOrder, cancelOrder } from "@/lib/markets/orders";
import { parseObjectId } from "@/lib/markets/route-params";
import { requireAdmin } from "@/lib/require-admin";

async function resolve(params: Promise<{ id: string; orderId: string }>) {
  const { id, orderId } = await params;
  return parseObjectId(id) && parseObjectId(orderId) ? { id, orderId } : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const resolved = await resolve(params);
  if (!resolved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = orderAmendSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid amendment" },
      { status: 400 },
    );
  }

  // A terminal order is not amendable, so a miss here is a 404 rather than a
  // silent no-op that leaves the UI showing an edit that never landed.
  const order = await amendOrder(resolved.id, resolved.orderId, parsed.data);
  return order
    ? NextResponse.json({ order })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; orderId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const resolved = await resolve(params);
  if (!resolved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const order = await cancelOrder(resolved.id, resolved.orderId);
  return order
    ? NextResponse.json({ order })
    : NextResponse.json({ error: "Not found" }, { status: 404 });
}
