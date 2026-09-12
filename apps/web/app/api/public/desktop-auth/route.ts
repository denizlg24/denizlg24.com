import type { DesktopAuthConfig } from "@repo/schemas/cloud";
import { NextResponse } from "next/server";
import { siteResourceConfig } from "@/lib/cloud-oauth";

export const dynamic = "force-dynamic";

/**
 * How the desktop app signs in to this site. Public on purpose: a native
 * client id is not a secret, and serving it from here — next to the issuer and
 * audience this site actually verifies — means a release binary carries no
 * environment-specific identifiers and a client rotation is an env change,
 * not a rebuild.
 */
export async function GET() {
  const clientId = process.env.DESKTOP_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "DESKTOP_OAUTH_CLIENT_ID is not set" },
      { status: 404 },
    );
  }
  const { issuer, resource } = siteResourceConfig();
  const body: DesktopAuthConfig = { issuer, clientId, resource };
  return NextResponse.json(body, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
