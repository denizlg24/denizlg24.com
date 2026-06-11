import { connectDB } from "@/lib/mongodb";
import { EmailModel } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";
import type { ToolDefinition } from "./types";

export const emailTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_emails",
      description:
        "List recent emails. Returns subject, sender, date, and read status.",
      input_schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max number of emails to return (default 20)",
          },
          unreadOnly: {
            type: "boolean",
            description: "Only show unread emails (default false)",
          },
        },
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const limit = (input.limit as number) || 20;
      const filter: Record<string, unknown> = {};
      if (input.unreadOnly) filter.seen = false;
      const emails = await EmailModel.find(filter)
        .sort({ date: -1 })
        .limit(limit)
        .lean();
      return emails.map((e) => ({
        _id: e._id.toString(),
        subject: e.subject,
        from: e.from,
        date: e.date,
        seen: e.seen,
      }));
    },
  },
  {
    schema: {
      name: "get_email",
      description: "Get details of a specific email by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Email ID" },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const email = await EmailModel.findById(input.id as string).lean();
      if (!email) return { success: false, error: "Email not found" };
      return {
        _id: email._id.toString(),
        subject: email.subject,
        from: email.from,
        date: email.date,
        seen: email.seen,
      };
    },
  },
  {
    schema: {
      name: "mark_email_as_read",
      description: "Mark a specific email as read by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Email ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const result = await EmailModel.findByIdAndUpdate(
        input.id as string,
        { seen: true },
        { new: true },
      ).lean();
      if (!result) throw new Error("Email not found");
      return {
        _id: result._id.toString(),
        subject: result.subject,
        from: result.from,
        date: result.date,
        seen: result.seen,
      };
    },
  },
  {
    schema: {
      name: "delete_email",
      description: "Delete a specific email by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Email ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const result = await EmailModel.findByIdAndDelete(
        input.id as string,
      ).lean();
      if (!result) return { success: false, error: "Email not found" };
      return { success: true };
    },
  },
  {
    schema: {
      name: "list_account_emails",
      description: "List a specific account's emails.",
      input_schema: {
        type: "object",
        properties: {
          account: {
            type: "string",
            description: "Account name (e.g. 'example@co.com')",
          },
          limit: {
            type: "number",
            description: "Max number of emails to return (default 20)",
          },
        },
        required: ["account"],
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const limit = (input.limit as number) || 20;
      const account = await EmailAccountModel.findOne({
        user: input.account as string,
      }).lean();
      if (!account) return { success: false, error: "Email account not found" };
      const accountId = account._id;
      const emails = await EmailModel.find({ accountId })
        .sort({ date: -1 })
        .limit(limit)
        .lean();
      return emails.map((e) => ({
        _id: e._id.toString(),
        subject: e.subject,
        from: e.from,
        date: e.date,
        seen: e.seen,
      }));
    },
  },
];
