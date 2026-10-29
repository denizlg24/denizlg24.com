import { AGENT_ACTOR_HEADER } from "@repo/schemas";
import { forbidden } from "next/navigation";
import { type NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import { callerFrom } from "./actor";
import { workspaceService } from "./index";
import {
  type WorkspaceCaller,
  WorkspaceError,
  type WorkspaceService,
} from "./service";

export async function workspaceCaller(
  request: NextRequest,
): Promise<WorkspaceCaller> {
  const session = await getAdminSession(request);
  if (!session) forbidden();
  return callerFrom(session, request.headers.get(AGENT_ACTOR_HEADER));
}

export function workspaceErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.status },
    );
  }
  console.error("Workspace request failed:", error);
  return NextResponse.json(
    { error: "Workspace request failed" },
    { status: 500 },
  );
}

/** Authenticates, migrates on first use, and maps `WorkspaceError` to its status. */
export async function withWorkspace(
  request: NextRequest,
  handle: (
    service: WorkspaceService,
    caller: WorkspaceCaller,
  ) => Promise<Response>,
): Promise<Response> {
  const caller = await workspaceCaller(request);
  try {
    await connectDB();
    await workspaceService.ensureMigrated();
    return await handle(workspaceService, caller);
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function readBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.output<S>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    throw new WorkspaceError(400, "INVALID_INPUT", "Invalid request body", {
      issues: parsed.error.issues.slice(0, 5),
    });
  }
  return parsed.data;
}
