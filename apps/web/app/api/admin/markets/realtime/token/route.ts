import { mintRelayToken } from "@repo/markets/core";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Mints a short-lived token for the browser's relay socket. The Tiingo key
 * never leaves the relay, and this token grants nothing but a connection.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const secret = process.env.MARKETS_RELAY_TOKEN_SECRET;
  const url = process.env.NEXT_PUBLIC_MARKETS_RELAY_URL;
  if (!secret || !url) {
    // Not an error: with the relay unconfigured the client falls back to
    // polling the batched quotes route.
    return NextResponse.json(
      { error: "Relay not configured" },
      { status: 503 },
    );
  }

  const { token, expiresAt } = await mintRelayToken(secret);
  return NextResponse.json({ token, url, expiresAt });
}
