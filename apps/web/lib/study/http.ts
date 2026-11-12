import { type NextRequest, NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { StudyNotFoundError, StudyValidationError } from "./errors";

export type StudyParams = { params: Promise<{ id: string }> };

/** Admin gate plus the one mapping from study errors to status codes. */
export async function studyRoute(
  request: NextRequest,
  run: () => Promise<Response>,
): Promise<Response> {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    return await run();
  } catch (error) {
    if (error instanceof StudyNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof StudyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid input", issues: error.issues },
        { status: 400 },
      );
    }
    console.error("Study route failed:", error);
    return NextResponse.json(
      { error: "Study request failed" },
      { status: 500 },
    );
  }
}

export async function readBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new StudyValidationError("Body must be JSON");
  }
  return schema.parse(body);
}
