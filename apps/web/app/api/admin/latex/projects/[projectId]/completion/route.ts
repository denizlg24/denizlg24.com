import { latexInlineCompletionRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { latexProjectErrorResponse } from "@/lib/latex-project-route";
import { getLatexProject } from "@/lib/latex-projects";
import { generateText } from "@/lib/llm-service";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { requireAdmin } from "@/lib/require-admin";

export const runtime = "nodejs";
export const maxDuration = 15;

function cleanCompletion(value: string, prefix: string): string {
  const cleaned = value
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^\s*["']|["']\s*$/g, "")
    .slice(0, 1_000);
  return /[ \t]$/.test(prefix) ? cleaned.replace(/^[ \t]+/, "") : cleaned;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) {
  if (isCrossOriginCookieRequest(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = latexInlineCompletionRequestSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid completion context", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const { projectId } = await context.params;
    const project = await getLatexProject(projectId);
    if (project.revision !== parsed.data.revision) {
      return NextResponse.json(
        { error: "Project revision is stale", project },
        { status: 409 },
      );
    }
    const startedAt = performance.now();
    const { text } = await generateText({
      purpose: "chat",
      source: "latex-inline-completion",
      model:
        project.settings.inlineCompletionModel ||
        process.env.LATEX_INLINE_MODEL?.trim() ||
        "openai/gpt-5.4-mini",
      maxTokens: 96,
      system:
        "Complete academic LaTeX prose at the cursor. Return only the exact continuation, without quotes, Markdown fences, explanation, or text already present after the cursor. Keep commands and citations unchanged. One short phrase or sentence maximum.",
      logSystemPrompt:
        "Complete bounded LaTeX prose at the cursor; private project context redacted.",
      prompt: [
        `File: ${parsed.data.filePath}`,
        `Active paragraph:\n${parsed.data.paragraph}`,
        `Prefix immediately before cursor:\n${parsed.data.prefix}`,
        `Suffix immediately after cursor:\n${parsed.data.suffix}`,
        "Continuation:",
      ].join("\n\n"),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    return NextResponse.json(
      {
        completion: cleanCompletion(text, parsed.data.prefix),
        latencyMs,
        provider: "hosted",
      },
      { headers: { "server-timing": `latex-completion;dur=${latencyMs}` } },
    );
  } catch (error) {
    const handled = latexProjectErrorResponse(error);
    if (handled) return handled;
    console.error("LaTeX inline completion failed", error);
    return NextResponse.json(
      { error: "Inline completion is unavailable" },
      { status: 503 },
    );
  }
}
