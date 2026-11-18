import { type NextRequest, NextResponse } from "next/server";
import { listProviderModels } from "@/lib/ai-subscriptions/providers";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await listProviderModels(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Model providers are unavailable." },
      { status: 503 },
    );
  }
}
