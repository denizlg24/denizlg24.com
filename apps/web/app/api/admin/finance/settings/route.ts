import { financeSettingsInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  getFinanceSettings,
  serializeFinanceSettings,
  updateFinanceSettings,
} from "@/lib/finance/settings";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const settings = await getFinanceSettings();
    return NextResponse.json({ settings: serializeFinanceSettings(settings) });
  } catch (error) {
    console.error("[finance] Settings read failed", error);
    return NextResponse.json(
      { error: "Failed to load finance settings" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeSettingsInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid finance settings" },
      { status: 400 },
    );
  }
  try {
    const settings = await updateFinanceSettings(parsed.data);
    return NextResponse.json({ settings: serializeFinanceSettings(settings) });
  } catch (error) {
    console.error("[finance] Settings update failed", error);
    return NextResponse.json(
      { error: "Failed to save finance settings" },
      { status: 500 },
    );
  }
}
