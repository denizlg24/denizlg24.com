import { type NextRequest, NextResponse } from "next/server";
import { AiConnectionError } from "@/lib/ai-connections/errors";
import {
  aiConnectionErrorResponse,
  authenticatedOAuthSession,
} from "@/lib/ai-connections/http";
import {
  completeVercelOAuth,
  VERCEL_FLOW_COOKIE,
  vercelFlowCookieOptions,
} from "@/lib/ai-connections/oauth";
import { requireVercelOAuthConfig } from "@/lib/ai-connections/vercel-config";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  let response: NextResponse;
  try {
    const sessionHash = await authenticatedOAuthSession(request);
    const params = request.nextUrl.searchParams;
    if (params.has("error"))
      throw new AiConnectionError(
        "oauth_denied",
        "Vercel authorization was not completed.",
      );
    await completeVercelOAuth({
      sessionHash,
      state: params.get("state") ?? "",
      code: params.get("code") ?? "",
      cookieState: request.cookies.get(VERCEL_FLOW_COOKIE)?.value ?? "",
    });
    response = NextResponse.redirect(
      new URL(
        "/admin/dashboard/settings/models?aiConnection=connected",
        requireVercelOAuthConfig().redirectUri,
      ),
    );
  } catch (error) {
    response = aiConnectionErrorResponse(error);
  }
  response.cookies.set(VERCEL_FLOW_COOKIE, "", {
    ...vercelFlowCookieOptions,
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
