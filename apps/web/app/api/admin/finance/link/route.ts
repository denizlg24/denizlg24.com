import { financeBeginLinkRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { beginFinanceLink } from "@/lib/finance/connection";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeBeginLinkRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid finance link request" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await beginFinanceLink(parsed.data));
  } catch (error) {
    console.error("[finance] Link start failed", error);
    return NextResponse.json(
      { error: "Failed to start bank link" },
      { status: 502 },
    );
  }
}
