import { NextResponse } from "next/server";
import { handleWebhook } from "@/lib/billing/polar";

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const outcome = await handleWebhook(body, request.headers);
    return NextResponse.json(
      "error" in outcome
        ? { error: outcome.error }
        : { result: outcome.result },
      { status: outcome.status },
    );
  } catch (error) {
    console.error("Polar webhook failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  }
}
