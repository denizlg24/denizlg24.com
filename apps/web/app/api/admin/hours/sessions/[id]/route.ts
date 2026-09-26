import { workSessionUpdateSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { deleteWorkSession, updateWorkSession } from "@/lib/work-hours";
import { hoursErrorResponse } from "../../errors";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  const parsed = workSessionUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid shift" }, { status: 400 });
  }
  try {
    const session = await updateWorkSession(id, parsed.data);
    if (!session) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error) {
    return hoursErrorResponse(error, "Failed to update shift");
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  try {
    const session = await deleteWorkSession(id);
    if (!session) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return hoursErrorResponse(error, "Failed to delete shift");
  }
}
