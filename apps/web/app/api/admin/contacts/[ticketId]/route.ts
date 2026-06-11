import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteContact,
  getContactByTicketId,
  markEmailSent,
  updateContactStatus,
} from "@/lib/contacts";
import { getAdminSession } from "@/lib/require-admin";

const updateStatusSchema = z.object({
  status: z.enum(["pending", "read", "responded", "archived"]),
});

const markEmailSentSchema = z.object({
  emailSent: z.boolean(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ticketId } = await params;
    const contact = await getContactByTicketId(ticketId);

    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json(contact);
  } catch (error) {
    console.error("Error fetching contact:", error);
    return NextResponse.json(
      { error: "Failed to fetch contact" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ticketId } = await params;
    const body = await request.json();

    if ("status" in body) {
      const validationResult = updateStatusSchema.safeParse(body);
      if (!validationResult.success) {
        return NextResponse.json(
          { error: "Invalid status value" },
          { status: 400 },
        );
      }

      const contact = await updateContactStatus(
        ticketId,
        validationResult.data.status,
      );

      if (!contact) {
        return NextResponse.json(
          { error: "Contact not found" },
          { status: 404 },
        );
      }

      return NextResponse.json({ success: true, contact });
    }

    if ("emailSent" in body) {
      const validationResult = markEmailSentSchema.safeParse(body);
      if (!validationResult.success) {
        return NextResponse.json(
          { error: "Invalid emailSent value" },
          { status: 400 },
        );
      }

      const success = await markEmailSent(ticketId);

      if (!success) {
        return NextResponse.json(
          { error: "Contact not found" },
          { status: 404 },
        );
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 },
    );
  } catch (error) {
    console.error("Error updating contact:", error);
    return NextResponse.json(
      { error: "Failed to update contact" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ticketId } = await params;
    const success = await deleteContact(ticketId);

    if (!success) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting contact:", error);
    return NextResponse.json(
      { error: "Failed to delete contact" },
      { status: 500 },
    );
  }
}
