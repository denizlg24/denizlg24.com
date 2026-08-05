import { orderInputSchema, orderStatusSchema } from "@repo/markets/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { listOrders, OrderRejected, placeOrder } from "@/lib/markets/orders";
import { getPortfolio } from "@/lib/markets/portfolios";
import { parseObjectId } from "@/lib/markets/route-params";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!parseObjectId(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // `?status=working&status=pending` narrows the blotter to the live book
  // without pulling a fill history that only grows.
  const requested = request.nextUrl.searchParams.getAll("status");
  const parsed = orderStatusSchema.array().safeParse(requested);
  if (requested.length > 0 && !parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  return NextResponse.json({
    orders: await listOrders(id, parsed.success ? parsed.data : undefined),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = orderInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid order" },
      { status: 400 },
    );
  }

  const { id } = await params;
  if (!parseObjectId(id) || !(await getPortfolio(id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    // A bracket returns its legs alongside the entry, so the ticket can show
    // what it actually created rather than only the order that was typed.
    const orders = await placeOrder(id, parsed.data);
    return NextResponse.json({ orders }, { status: 201 });
  } catch (error) {
    if (error instanceof OrderRejected) {
      // 422, not 400: the order is well-formed and was understood, and the
      // reason it was refused — buying power, no position to reduce — is a
      // message the owner acts on rather than a malformed request.
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error("[markets] Order placement failed", error);
    return NextResponse.json({ error: "Order failed" }, { status: 500 });
  }
}
