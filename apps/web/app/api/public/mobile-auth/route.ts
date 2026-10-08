import type { DesktopAuthConfig } from "@repo/schemas/cloud";
import { NextResponse } from "next/server";
import { siteResourceConfig } from "@/lib/cloud-oauth";

export const dynamic = "force-dynamic";

/**
 * How the iPhone apps (Hours, Voice) sign in to this site: the desktop's
 * contract with its own client, so a rotation is an env change here and not a
 * reinstall. One `native` client holds every app's private-use redirect.
 */
export async function GET() {
  const clientId = process.env.MOBILE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "MOBILE_OAUTH_CLIENT_ID is not set" },
      { status: 404 },
    );
  }
  const { issuer, resource } = siteResourceConfig();
  const body: DesktopAuthConfig = { issuer, clientId, resource };
  return NextResponse.json(body, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
