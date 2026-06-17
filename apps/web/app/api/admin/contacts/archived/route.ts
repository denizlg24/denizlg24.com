import { type NextRequest, NextResponse } from "next/server";
import { deleteArchivedContacts } from "@/lib/contacts";
import { getAdminSession } from "@/lib/require-admin";

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deletedCount = await deleteArchivedContacts();

    return NextResponse.json({ success: true, deletedCount });
  } catch (error) {
    console.error("Error deleting archived contacts:", error);
    return NextResponse.json(
      { error: "Failed to delete archived contacts" },
      { status: 500 },
    );
  }
}
