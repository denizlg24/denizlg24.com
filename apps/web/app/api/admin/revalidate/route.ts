import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  PUBLIC_CONTENT_TARGETS,
  revalidatePublicContent,
} from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";

const revalidationRequestSchema = z.object({
  targets: z.array(z.enum(PUBLIC_CONTENT_TARGETS)),
});

function hasValidRevalidationSecret(request: NextRequest): boolean {
  const expectedSecret = process.env.REVALIDATE_SECRET?.trim();
  const providedSecret = request.headers.get("x-revalidate-secret")?.trim();

  if (!expectedSecret || !providedSecret) return false;

  const expectedBuffer = Buffer.from(expectedSecret);
  const providedBuffer = Buffer.from(providedSecret);

  if (expectedBuffer.length !== providedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

async function authorizeRequest(request: NextRequest) {
  if (hasValidRevalidationSecret(request)) return null;

  try {
    const authError = await requireAdmin(request);
    return authError ?? null;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const authError = await authorizeRequest(request);
  if (authError) return authError;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validationResult = revalidationRequestSchema.safeParse(body);
  if (!validationResult.success) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: validationResult.error.flatten(),
      },
      { status: 400 },
    );
  }

  const invalidatedTargets = revalidatePublicContent(
    validationResult.data.targets,
  );

  return NextResponse.json(
    { success: true, targets: invalidatedTargets },
    { status: 200 },
  );
}
