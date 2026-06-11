import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailModel } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await connectDB();

    await EmailModel.deleteMany({ accountId: id });

    const account = await EmailAccountModel.findByIdAndDelete(id);

    if (!account) {
      return NextResponse.json(
        { error: "Email account not found" },
        { status: 404 },
      );
    }

    revalidatePath("/admin/dashboard/inbox");

    return NextResponse.json(
      { message: "Email account deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting email account:", error);
    return NextResponse.json(
      { error: "Failed to delete email account" },
      { status: 500 },
    );
  }
}
