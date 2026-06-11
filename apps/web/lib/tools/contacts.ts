import {
  getAllContacts,
  getContactByTicketId,
  updateContactStatus,
} from "@/lib/contacts";
import { connectDB } from "../mongodb";
import { resend } from "../resend";
import type { ToolDefinition } from "./types";

export const contactsTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_contacts",
      description:
        "List contact form submissions. Can filter by status and paginate.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Filter by status (optional)",
            enum: ["pending", "read", "responded", "archived"],
          },
          limit: {
            type: "number",
            description: "Max number of contacts to return (default 20)",
          },
        },
      },
    },
    isWrite: false,
    category: "contacts",
    execute: async (input) => {
      return await getAllContacts({
        status: input.status as
          | "pending"
          | "read"
          | "responded"
          | "archived"
          | undefined,
        limit: (input.limit as number) || 20,
      });
    },
  },
  {
    schema: {
      name: "get_contact",
      description: "Get a specific contact submission by its ticket ID.",
      input_schema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "Contact ticket ID" },
        },
        required: ["ticketId"],
      },
    },
    isWrite: false,
    category: "contacts",
    execute: async (input) => {
      const contact = await getContactByTicketId(input.ticketId as string);
      if (!contact) throw new Error("Contact not found");
      return contact;
    },
  },
  {
    schema: {
      name: "update_contact_status",
      description: "Update the status of a contact submission.",
      input_schema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "Contact ticket ID" },
          status: {
            type: "string",
            description: "New status",
            enum: ["pending", "read", "responded", "archived"],
          },
        },
        required: ["ticketId", "status"],
      },
    },
    isWrite: true,
    category: "contacts",
    execute: async (input) => {
      const result = await updateContactStatus(
        input.ticketId as string,
        input.status as "pending" | "read" | "responded" | "archived",
      );
      if (!result) throw new Error("Contact not found");
      return result;
    },
  },
  {
    schema: {
      name: "reply_to_contact",
      description:
        "Send a reply to a contact submission and mark it as responded.",
      input_schema: {
        type: "object",
        properties: {
          ticketId: { type: "string", description: "Contact ticket ID" },
          message: { type: "string", description: "Reply message" },
        },
        required: ["ticketId", "message"],
      },
    },
    isWrite: true,
    category: "contacts",
    execute: async (input) => {
      await connectDB();
      const contact = await getContactByTicketId(input.ticketId as string);
      if (!contact) return { success: false, error: "Contact not found" };

      const email = contact.email;
      const message = input.message as string;

      const response = await resend.emails.send({
        to: email,
        from: "Deniz Günes <denizgunes@oceaninformatix.com>",
        subject: `Re: Deniz Günes Portfolio Contact - Ticket #${contact.ticketId}`,
        text: message,
      });
      if (response.error) {
        return {
          success: false,
          error: response.error.message || "Failed to send email",
        };
      }
      await updateContactStatus(contact.ticketId, "responded");
      return { success: true };
    },
  },
];
