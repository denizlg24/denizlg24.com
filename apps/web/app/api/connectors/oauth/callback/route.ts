import { type NextRequest, NextResponse } from "next/server";
import { WEB_ADMIN_ROUTES } from "@/lib/admin-routes";
import {
  ConnectorError,
  completeConnectorAuthorization,
} from "@/lib/connectors/service";

/**
 * The redirect target registered with every third-party authorization
 * server. It is public: the connector is located by the unexpired `state`
 * hash, so a stale or forged callback finds nothing.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const settings = new URL(WEB_ADMIN_ROUTES.settings, request.nextUrl.origin);
  settings.hash = "connectors";
  const state = params.get("state");
  const code = params.get("code");
  const denied = params.get("error");
  if (denied) {
    settings.searchParams.set("connector", `denied:${denied}`);
    return NextResponse.redirect(settings);
  }
  if (!state || !code) {
    settings.searchParams.set("connector", "invalid-callback");
    return NextResponse.redirect(settings);
  }
  try {
    const connector = await completeConnectorAuthorization({
      state,
      code,
      issuer: params.get("iss") ?? undefined,
    });
    settings.searchParams.set("connector", `authorized:${connector.slug}`);
  } catch (error) {
    settings.searchParams.set(
      "connector",
      `failed:${error instanceof ConnectorError ? error.message : "authorization"}`,
    );
  }
  return NextResponse.redirect(settings);
}
