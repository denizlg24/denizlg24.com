import { contactReplySchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { getContactByTicketId, updateContactStatus } from "@/lib/contacts";
import { requireAdmin } from "@/lib/require-admin";
import { sendContactReply } from "@/lib/resend";

/** Sends the reply first; the ticket only reads responded once the mail went out. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { ticketId } = await params;
  const parsed = contactReplySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reply", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const contact = await getContactByTicketId(ticketId);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }
    const sent = await sendContactReply({
      to: contact.email,
      ticketId: contact.ticketId,
      message: parsed.data.message,
    });
    if (!sent.ok) {
      return NextResponse.json(
        { error: `Sending the reply failed: ${sent.error}` },
        { status: 502 },
      );
    }
    const updated = await updateContactStatus(contact.ticketId, "responded");
    return NextResponse.json({ success: true, contact: updated });
  } catch (error) {
    console.error("Error replying to contact:", error);
    return NextResponse.json(
      { error: "Failed to reply to contact" },
      { status: 500 },
    );
  }
}
