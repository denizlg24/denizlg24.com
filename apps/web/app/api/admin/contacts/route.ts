import { type NextRequest, NextResponse } from "next/server";
import { getAllContacts, getContactCountByStatus } from "@/lib/contacts";
import { getAdminSession } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [contacts, stats] = await Promise.all([
      getAllContacts({ limit: 100 }),
      getContactCountByStatus(),
    ]);

    return NextResponse.json({ contacts, stats });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch contacts" },
      { status: 500 },
    );
  }
}
