import { gatewayTeamSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { AiConnectionError } from "@/lib/ai-connections/errors";
import {
  aiConnectionErrorResponse,
  authenticatedOAuthSession,
} from "@/lib/ai-connections/http";
import {
  beginVercelOAuth,
  VERCEL_FLOW_COOKIE,
  vercelFlowCookieOptions,
} from "@/lib/ai-connections/oauth";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const sessionHash = await authenticatedOAuthSession(request, true);
    const team = gatewayTeamSchema
      .optional()
      .safeParse(request.nextUrl.searchParams.get("teamIdOrSlug") ?? undefined);
    if (!team.success)
      throw new AiConnectionError("input", "Invalid Vercel team.");
    const flow = await beginVercelOAuth(sessionHash, team.data);
    const response = NextResponse.redirect(flow.url);
    response.cookies.set(
      VERCEL_FLOW_COOKIE,
      flow.state,
      vercelFlowCookieOptions,
    );
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    return aiConnectionErrorResponse(error);
  }
}
