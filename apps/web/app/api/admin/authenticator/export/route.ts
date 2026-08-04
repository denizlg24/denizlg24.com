import { type NextRequest, NextResponse } from "next/server";
import { exportAccounts } from "@/lib/authenticator";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Full secret export for the browser extension's offline vault.
 *
 * Unlike `/codes`, which hands out a value that expires in seconds, this hands
 * out the secrets themselves. Responses are marked no-store so nothing between
 * here and the extension keeps a copy.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const accounts = await exportAccounts();
    return NextResponse.json(
      { accounts, exportedAt: new Date().toISOString() },
      {
        status: 200,
        headers: {
          "cache-control": "no-store, no-cache, must-revalidate, private",
        },
      },
    );
  } catch (error) {
    console.error("Error exporting authenticator accounts:", error);
    return NextResponse.json(
      { error: "Failed to export accounts" },
      { status: 500 },
    );
  }
}
