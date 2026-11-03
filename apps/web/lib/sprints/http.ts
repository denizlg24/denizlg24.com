import { type NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { getAdminSession, requireAdmin } from "@/lib/require-admin";
import { isAgentRunner } from "./runner-gate";
import { SprintError } from "./service";

export function sprintErrorResponse(error: unknown): NextResponse {
  if (error instanceof SprintError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.status },
    );
  }
  console.error("[Sprints] Request failed", error);
  return NextResponse.json({ error: "Sprint request failed" }, { status: 500 });
}

export async function withSprints(
  request: NextRequest,
  handle: () => Promise<Response>,
): Promise<Response> {
  await requireAdmin(request);
  try {
    return await handle();
  } catch (error) {
    return sprintErrorResponse(error);
  }
}

export async function withRunner(
  request: NextRequest,
  handle: () => Promise<Response>,
): Promise<Response> {
  const session = await getAdminSession(request);
  if (!isAgentRunner(session, process.env.AGENT_RUNNER_CLIENT_ID)) {
    return NextResponse.json(
      { error: "Forbidden", code: "NOT_RUNNER" },
      { status: 403 },
    );
  }
  try {
    return await handle();
  } catch (error) {
    return sprintErrorResponse(error);
  }
}

export async function readBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.output<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new SprintError(400, "INVALID_INPUT", "Invalid request body", {
      issues: parsed.error.issues.slice(0, 5),
    });
  }
  return parsed.data;
}
