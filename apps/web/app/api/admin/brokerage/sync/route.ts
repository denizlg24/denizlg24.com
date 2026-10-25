import { brokerageSyncInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { FlexError } from "@/lib/brokerage/flex";
import {
  BrokerageNotConfiguredError,
  runBrokerageSync,
} from "@/lib/brokerage/sync";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = brokerageSyncInputSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid sync request" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await runBrokerageSync(parsed.data));
  } catch (error) {
    if (error instanceof BrokerageNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof FlexError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 502 },
      );
    }
    console.error("[brokerage] Sync failed", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
