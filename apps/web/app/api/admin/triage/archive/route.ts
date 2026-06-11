import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailTriageModel } from "@/models/EmailTriage";

const TRIAGE_CATEGORIES = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTriageCategory(
  value: unknown,
): value is (typeof TRIAGE_CATEGORIES)[number] {
  return (
    typeof value === "string" &&
    TRIAGE_CATEGORIES.some((category) => category === value)
  );
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();

  const body = await request.json().catch(() => null);
  const payload = isRecord(body) ? body : {};

  if (!isTriageCategory(payload.category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const result = await EmailTriageModel.updateMany(
    {
      category: payload.category,
      userStatus: { $ne: "archived" },
    },
    {
      $set: {
        userStatus: "archived",
      },
    },
  );

  return NextResponse.json({
    ok: true,
    modifiedCount: result.modifiedCount,
  });
}
