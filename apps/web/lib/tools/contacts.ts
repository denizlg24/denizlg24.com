import { z } from "zod";

import {
  deleteContact,
  getAllContacts,
  getContactByTicketId,
  updateContactStatus,
} from "@/lib/contacts";
import { connectDB } from "../mongodb";
import { resend } from "../resend";
import { defineTool } from "./define";
import type { ToolDefinition } from "./types";

const contactStatus = z.enum(["pending", "read", "responded", "archived"]);

const ticketId = z
  .string()
  .min(1)
  .describe("Ticket id exactly as list_contacts returned it");

/** Every path out of a missing ticket, so none of them says only "not found". */
function missingContact(id: string) {
  return {
    success: false as const,
    error: `No contact has ticket id "${id}". Call list_contacts to see the ticket ids that exist.`,
  };
}

export const contactsTools: ToolDefinition[] = [
  defineTool({
    name: "list_contacts",
    description:
      "List contact form submissions. Can filter by status and paginate.",
    isWrite: false,
    category: "contacts",
    input: z.object({
      status: contactStatus
        .optional()
        .describe("Filter by status. Omit to list every status."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Max number of contacts to return"),
    }),
    execute: async (input) =>
      getAllContacts({ status: input.status, limit: input.limit }),
  }),
  defineTool({
    name: "get_contact",
    description: "Get a specific contact submission by its ticket ID.",
    isWrite: false,
    category: "contacts",
    input: z.object({ ticketId }),
    execute: async (input) => {
      const contact = await getContactByTicketId(input.ticketId);
      if (!contact) return missingContact(input.ticketId);
      return contact;
    },
  }),
  defineTool({
    name: "update_contact_status",
    description: "Update the status of a contact submission.",
    isWrite: true,
    category: "contacts",
    input: z.object({
      ticketId,
      status: contactStatus.describe("New status"),
    }),
    execute: async (input) => {
      const result = await updateContactStatus(input.ticketId, input.status);
      if (!result) return missingContact(input.ticketId);
      return result;
    },
  }),
  defineTool({
    name: "reply_to_contact",
    description:
      "Send a reply to a contact submission and mark it as responded.",
    isWrite: true,
    category: "contacts",
    input: z.object({
      ticketId,
      message: z.string().min(1).describe("Reply message, sent as plain text"),
    }),
    execute: async (input) => {
      await connectDB();
      const contact = await getContactByTicketId(input.ticketId);
      if (!contact) return missingContact(input.ticketId);

      const response = await resend.emails.send({
        to: contact.email,
        from: "Deniz Günes <denizgunes@oceaninformatix.com>",
        subject: `Re: Deniz Günes Portfolio Contact - Ticket #${contact.ticketId}`,
        text: input.message,
      });
      if (response.error) {
        return {
          success: false,
          error: `Sending the reply to ${contact.email} failed: ${response.error.message || "the mail provider gave no reason"}. The contact was not marked responded.`,
        };
      }
      await updateContactStatus(contact.ticketId, "responded");
      return { success: true };
    },
  }),
  defineTool({
    name: "delete_contact",
    description:
      "Permanently delete a contact submission. Prefer archiving with update_contact_status unless removal is actually wanted — this cannot be undone.",
    isWrite: true,
    category: "contacts",
    input: z.object({ ticketId }),
    execute: async (input) => {
      const deleted = await deleteContact(input.ticketId);
      if (!deleted) return missingContact(input.ticketId);
      return { success: true };
    },
  }),
];
