import {
  type MacrosDistributionRequestReceipt,
  type MacrosDistributionRequestsResponse,
  macrosCreateDistributionRequestBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/distribution/access";
import {
  listDistributionRequests,
  submitDistributionRequest,
} from "@/lib/distribution/service";
import { clientAddress, createThrottle } from "@/lib/distribution/throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const allowSubmission = createThrottle({ limit: 5, windowMs: 15 * 60_000 });

export async function GET() {
  const { session, response } = await requireOwner();
  if (!session) return response;

  const requests = await listDistributionRequests();
  return NextResponse.json({
    requests,
  } satisfies MacrosDistributionRequestsResponse);
}

export async function POST(request: Request) {
  if (!allowSubmission(clientAddress(request))) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a few minutes." },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = macrosCreateDistributionRequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // A filled honeypot gets the same answer a person would, and nothing saved.
  if (parsed.data.website) {
    return NextResponse.json(
      { status: "pending" } satisfies MacrosDistributionRequestReceipt,
      { status: 201 },
    );
  }

  const { status, created } = await submitDistributionRequest(parsed.data);
  return NextResponse.json(
    { status } satisfies MacrosDistributionRequestReceipt,
    { status: created ? 201 : 200 },
  );
}
