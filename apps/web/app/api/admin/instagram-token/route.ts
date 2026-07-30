import { type NextRequest, NextResponse } from "next/server";
import { deleteInstagramToken, getInstagramToken } from "@/lib/instagram-token";
import { requireAdmin } from "@/lib/require-admin";

const SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_insights",
].join(",");

/**
 * The authorize URL is assembled here rather than in the client because the app
 * id and redirect URI are server env. Desktop opens the returned URL in the
 * system browser — the OAuth callback always lands on the web app.
 */
function buildAuthorizeUrl(): string | null {
  const appId = process.env.INSTAGRAM_APP_ID;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
  if (!appId || !redirectUri) return null;

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const token = await getInstagramToken();
    return NextResponse.json({
      token: token
        ? {
            id: token._id.toString(),
            expiresAt: new Date(token.expiresAt).toISOString(),
          }
        : null,
      authorizeUrl: buildAuthorizeUrl(),
    });
  } catch (error) {
    console.error("Error reading Instagram token:", error);
    return NextResponse.json(
      { error: "Failed to read Instagram token" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const deleted = await deleteInstagramToken();
    if (deleted === 0) {
      return NextResponse.json({ error: "No token" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting Instagram token:", error);
    return NextResponse.json(
      { error: "Failed to delete Instagram token" },
      { status: 500 },
    );
  }
}
