import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chatgptCredentialSchema } from "@/lib/ai-subscriptions/contract";
import {
  chatgptAccessToken,
  chatgptModels,
  importedChatgptModels,
} from "@/lib/ai-subscriptions/service";
import { isCrossOriginCookieRequest } from "@/lib/request-security";
import { getAdminSession } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (
    isCrossOriginCookieRequest(request) ||
    (session.via === "session" &&
      request.headers.get("sec-fetch-site") === "cross-site")
  )
    return NextResponse.json(
      { error: "Cross-origin request rejected" },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 150_000)
    return NextResponse.json(
      { error: "Connection file is too large." },
      { status: 413 },
    );
  try {
    const parsed = z
      .object({ credentials: chatgptCredentialSchema.optional() })
      .safeParse(await request.json());
    if (!parsed.success)
      return NextResponse.json(
        { error: "Choose a valid ChatGPT connection file." },
        { status: 400 },
      );
    const models = parsed.data.credentials
      ? await importedChatgptModels(parsed.data.credentials)
      : await chatgptModels(await chatgptAccessToken());
    return NextResponse.json(
      { models },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not load ChatGPT models. Sign in again and check plan access.",
      },
      { status: 400 },
    );
  }
}
