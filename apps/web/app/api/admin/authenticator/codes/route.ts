import { type NextRequest, NextResponse } from "next/server";
import { generateCodes } from "@/lib/authenticator";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const codes = await generateCodes();
    return NextResponse.json({ codes }, { status: 200 });
  } catch (error) {
    console.error("Error generating TOTP codes:", error);
    return NextResponse.json(
      { error: "Failed to generate codes" },
      { status: 500 },
    );
  }
}
