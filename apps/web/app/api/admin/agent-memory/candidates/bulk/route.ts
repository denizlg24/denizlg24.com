import {
  bulkAgentCandidateDecisionResponseSchema,
  bulkAgentCandidateDecisionSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  acceptMemoryCandidate,
  dismissMemoryCandidate,
} from "@/lib/agent-memory/governance";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = bulkAgentCandidateDecisionSchema.safeParse(
    await request.json(),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid bulk candidate decision" },
      { status: 400 },
    );
  }

  let succeeded = 0;
  const failed: { candidateId: string; error: string }[] = [];
  for (const candidateId of parsed.data.candidateIds) {
    try {
      if (parsed.data.action === "accept") {
        await acceptMemoryCandidate({
          candidateId,
          actor: "user",
          reason: parsed.data.reason,
        });
      } else {
        await dismissMemoryCandidate({
          candidateId,
          reason: parsed.data.reason,
        });
      }
      succeeded += 1;
    } catch (error) {
      failed.push({
        candidateId,
        error: error instanceof Error ? error.message : "Decision failed",
      });
    }
  }

  return NextResponse.json(
    bulkAgentCandidateDecisionResponseSchema.parse({ succeeded, failed }),
  );
}
