import { type NextRequest, NextResponse } from "next/server";
import { importAccounts } from "@/lib/authenticator";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { uris } = body;

    if (!Array.isArray(uris) || uris.length === 0) {
      return NextResponse.json(
        { error: "uris must be a non-empty array of otpauth:// URIs" },
        { status: 400 },
      );
    }

    if (uris.length > 100) {
      return NextResponse.json(
        { error: "Maximum 100 URIs per import" },
        { status: 400 },
      );
    }

    const result = await importAccounts(uris);

    return NextResponse.json(
      {
        message: `Imported ${result.imported.length} account(s)`,
        imported: result.imported,
        errors: result.errors,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error importing authenticator accounts:", error);
    return NextResponse.json(
      { error: "Failed to import accounts" },
      { status: 500 },
    );
  }
}
