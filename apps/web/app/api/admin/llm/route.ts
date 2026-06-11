import type Anthropic from "@anthropic-ai/sdk";
import { type NextRequest, NextResponse } from "next/server";
import { createSSEStream, streamGenerate } from "@/lib/llm";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 300;

export const POST = async (req: NextRequest) => {
  const adminError = await requireAdmin(req);
  if (adminError) return adminError;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed, remaining, resetMs } = await checkRateLimit(`llm:${ip}`);

  if (!allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(resetMs / 1000)),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  try {
    const { prompt, systemPrompt, model, source } = await req.json();

    if (!prompt || !systemPrompt) {
      return NextResponse.json(
        { error: "prompt and systemPrompt are required" },
        { status: 400 },
      );
    }

    const result = await streamGenerate({
      system: systemPrompt,
      prompt,
      model: model as Anthropic.Model | undefined,
      source: source ?? "llm-api",
    });

    const sseStream = createSSEStream(result);

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-RateLimit-Remaining": String(remaining),
      },
    });
  } catch (error) {
    console.error("LLM route error:", error);
    return NextResponse.json(
      { error: "Failed to process LLM request" },
      { status: 500 },
    );
  }
};
