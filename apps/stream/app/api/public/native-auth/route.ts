import type { DesktopAuthConfig } from "@repo/schemas/cloud";
import { NextResponse } from "next/server";

import { authIssuer, streamResource } from "@/lib/config";

/** Installed apps learn their sign-in config here, so a client rotation is an env change. */
export function GET() {
  const clientId = process.env.STREAM_NATIVE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }
  const config: DesktopAuthConfig = {
    issuer: authIssuer(),
    clientId,
    resource: streamResource(),
  };
  return NextResponse.json(config, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
