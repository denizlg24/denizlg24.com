import { type NextRequest, NextResponse } from "next/server";
import { LlmConfigurationError, LlmModelError } from "@/lib/llm-errors";
import { streamText } from "@/lib/llm-service";
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

    const sseStream = await streamText({
      purpose: "llm-api",
      source: source ?? "llm-api",
      system: systemPrompt,
      prompt,
      model: model ?? "anthropic/claude-sonnet-4.5",
    });

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-RateLimit-Remaining": String(remaining),
      },
    });
  } catch (error) {
    if (error instanceof LlmModelError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof LlmConfigurationError) {
      return NextResponse.json(
        { error: "LLM service is not configured" },
        { status: 500 },
      );
    }
    console.error("LLM route error:", error);
    return NextResponse.json(
      { error: "Failed to process LLM request" },
      { status: 500 },
    );
  }
};
