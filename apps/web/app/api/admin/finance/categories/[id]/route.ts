import {
  financeCategoryDeleteSchema,
  financeCategoryInputSchema,
} from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import {
  deleteFinanceCategory,
  FinanceCategoryConflictError,
  updateFinanceCategory,
} from "@/lib/finance/categories";
import { serializeFinanceCategory } from "@/lib/finance/dashboard";
import { requireAdmin } from "@/lib/require-admin";

type Context = { params: Promise<{ id: string }> };
const updateSchema = financeCategoryInputSchema.partial();

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  try {
    const category = await updateFinanceCategory(id, parsed.data);
    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ category: serializeFinanceCategory(category) });
  } catch (error) {
    if (error instanceof FinanceCategoryConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[finance] Category update failed", error);
    return NextResponse.json(
      { error: "Failed to update category" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  const parsed = financeCategoryDeleteSchema.safeParse(
    await request.json().catch(() => ({})),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const result = await deleteFinanceCategory(id, parsed.data);
    if (!result) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[finance] Category deletion failed", error);
    return NextResponse.json(
      { error: "Failed to delete category" },
      { status: 500 },
    );
  }
}
