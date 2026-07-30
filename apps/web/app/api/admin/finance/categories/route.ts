import { financeCategoryInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  createFinanceCategory,
  FinanceCategoryConflictError,
  listFinanceCategories,
} from "@/lib/finance/categories";
import { serializeFinanceCategory } from "@/lib/finance/dashboard";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const categories = await listFinanceCategories();
  return NextResponse.json({
    categories: categories.map(serializeFinanceCategory),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = financeCategoryInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  try {
    const category = await createFinanceCategory(parsed.data);
    return NextResponse.json(
      { category: serializeFinanceCategory(category) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof FinanceCategoryConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Category creation failed", error);
    return NextResponse.json(
      { error: "Failed to create category" },
      { status: 500 },
    );
  }
}
