import { type NextRequest, NextResponse } from "next/server";
import { reorderColumns } from "@/lib/kanban";
import { requireAdmin } from "@/lib/require-admin";

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: "Invalid items array" },
        { status: 400 },
      );
    }

    await reorderColumns(items);
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to reorder columns" },
      { status: 500 },
    );
  }
}
