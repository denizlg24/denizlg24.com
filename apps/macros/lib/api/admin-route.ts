import { NextResponse } from "next/server";
import type { z } from "zod";

import { requireModerator } from "@/lib/api/moderator";
import { ModerationError } from "@/lib/moderation/service";

/**
 * Every `/api/admin/*` handler: the moderator gate, then the handler, with a
 * refused moderation step answered by its own status rather than a 500.
 */
export async function adminRoute(
  handler: (actor: string) => Promise<Response>,
): Promise<Response> {
  const gate = await requireModerator();
  if (gate.response) return gate.response;
  try {
    return await handler(gate.actor);
  } catch (error) {
    if (error instanceof ModerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[admin] request failed", error);
    return NextResponse.json({ error: "Request failed" }, { status: 500 });
  }
}

export function invalid(issues: z.core.$ZodIssue[]) {
  return NextResponse.json(
    { error: "Invalid request", issues },
    { status: 400 },
  );
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
