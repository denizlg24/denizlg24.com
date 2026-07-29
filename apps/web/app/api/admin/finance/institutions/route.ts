import { type NextRequest, NextResponse } from "next/server";
import { listFinanceInstitutions } from "@/lib/finance/connection";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const country = request.nextUrl.searchParams.get("country")?.toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: "Invalid country" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      institutions: await listFinanceInstitutions(country),
    });
  } catch (error) {
    console.error("[finance] Institution lookup failed", error);
    return NextResponse.json(
      { error: "Failed to load institutions" },
      { status: 502 },
    );
  }
}
