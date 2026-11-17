import { type NextRequest, NextResponse } from "next/server";
import {
  subscriptionProviderSchema,
  subscriptionUpdateSchema,
} from "@/lib/ai-subscriptions/contract";
import {
  disconnectSubscription,
  subscriptionStatus,
  updateSubscription,
} from "@/lib/ai-subscriptions/service";
import { LlmConfigurationError } from "@/lib/llm-errors";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { getAdminSession } from "@/lib/require-admin";

async function denied(request: NextRequest, mutation = false) {
  const session = await getAdminSession(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    mutation &&
    (isCrossOriginCookieRequest(request) ||
      (session.via === "session" &&
        request.headers.get("sec-fetch-site") === "cross-site"))
  ) {
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  }
  return null;
}
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof LlmConfigurationError
          ? error.message
          : "The connection could not be updated. Check the credential file and try again.",
    },
    { status: 400 },
  );
}
export async function GET(request: NextRequest) {
  const response = await denied(request);
  if (response) return response;
  try {
    return NextResponse.json(await subscriptionStatus(), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Connection settings are unavailable." },
      { status: 503 },
    );
  }
}
export async function PUT(request: NextRequest) {
  const response = await denied(request, true);
  if (response) return response;
  if (Number(request.headers.get("content-length")) > 150_000)
    return NextResponse.json(
      { error: "Connection file is too large." },
      { status: 413 },
    );
  try {
    const parsed = subscriptionUpdateSchema.safeParse(await request.json());
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid connection settings." },
        { status: 400 },
      );
    return NextResponse.json(await updateSubscription(parsed.data), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: NextRequest) {
  const response = await denied(request, true);
  if (response) return response;
  const provider = subscriptionProviderSchema.safeParse(
    request.nextUrl.searchParams.get("provider"),
  );
  if (!provider.success)
    return NextResponse.json(
      { error: "Choose a connection to disconnect." },
      { status: 400 },
    );
  try {
    return NextResponse.json(await disconnectSubscription(provider.data), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
