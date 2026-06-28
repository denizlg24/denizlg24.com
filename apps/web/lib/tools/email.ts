import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { isSmtpConfigured, sendMailFromAccount } from "@/lib/smtp";
import { EmailModel } from "@/models/Email";
import {
  EmailAccountModel,
  type ILeanEmailAccount,
} from "@/models/EmailAccount";
import { EmailDraftModel, type ILeanEmailDraft } from "@/models/EmailDraft";
import type { ToolDefinition } from "./types";

const MAX_RECIPIENTS = 50;

const emailDraftInputSchema = z
  .object({
    account: z
      .string()
      .trim()
      .describe("Optional sender account ID or email address")
      .optional(),
    to: z.array(z.email()).min(1).max(MAX_RECIPIENTS),
    cc: z.array(z.email()).max(MAX_RECIPIENTS).optional().default([]),
    bcc: z.array(z.email()).max(MAX_RECIPIENTS).optional().default([]),
    subject: z.string().trim().max(300).default(""),
    text: z.string().min(1).max(100_000),
    html: z.string().max(200_000).optional(),
    replyToMessageId: z.string().trim().max(500).optional(),
    previousDraftId: z.string().trim().optional(),
  })
  .refine((data) => data.to.length + data.cc.length + data.bcc.length <= 50, {
    message: "Too many recipients",
    path: ["to"],
  });

const sendEmailDraftInputSchema = z.object({
  draftId: z.string().trim().min(1),
});

function serializeEmailAccount(account: ILeanEmailAccount) {
  return {
    _id: account._id.toString(),
    user: account.user,
    displayName: account.displayName,
    provider: account.provider ?? "custom",
    smtpConfigured: isSmtpConfigured(account),
    smtpFromName: account.smtpFromName,
    smtpFromAddress: account.smtpFromAddress,
  };
}

function serializeEmailDraft(
  draft: ILeanEmailDraft,
  account: ILeanEmailAccount,
) {
  return {
    draftId: draft._id.toString(),
    from: account.smtpFromAddress || account.user,
    fromName: account.smtpFromName,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    replyToMessageId: draft.replyToMessageId,
    previousDraftId: draft.previousDraftId?.toString(),
    status: draft.status,
  };
}

async function resolveSendingAccount(accountRef: string | undefined) {
  const query = accountRef
    ? {
        $or: [
          ...(mongoose.Types.ObjectId.isValid(accountRef)
            ? [{ _id: accountRef }]
            : []),
          { user: accountRef },
          { displayName: accountRef },
        ],
      }
    : {};

  const accounts =
    await EmailAccountModel.find(query).lean<ILeanEmailAccount[]>();
  const account = accounts.find((item) => isSmtpConfigured(item));
  if (!account) {
    throw new Error(
      accountRef
        ? "Selected email account does not have SMTP sending configured"
        : "No SMTP-capable email account is configured",
    );
  }
  return account;
}

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
        { returnDocument: "after" },
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
      name: "list_email_accounts",
      description:
        "List configured email accounts and whether each can send through SMTP. Does not return passwords or secrets.",
      input_schema: {
        type: "object",
        properties: {
          sendingOnly: {
            type: "boolean",
            description:
              "Only return accounts with SMTP sending configured (default false)",
          },
        },
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const accounts =
        await EmailAccountModel.find().lean<ILeanEmailAccount[]>();
      const serialized = accounts.map(serializeEmailAccount);
      return input.sendingOnly
        ? serialized.filter((account) => account.smtpConfigured)
        : serialized;
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
  {
    schema: {
      name: "generate_email_draft",
      description:
        "Generate and store an email draft for review. This does not send email. Always use this before request_send_email.",
      input_schema: {
        type: "object",
        properties: {
          account: {
            type: "string",
            description:
              "Optional sender account ID, email address, or display name. If omitted, the first SMTP-capable account is used.",
          },
          to: {
            type: "array",
            description: "Recipient email addresses",
            items: { type: "string" },
          },
          cc: {
            type: "array",
            description: "CC email addresses (optional)",
            items: { type: "string" },
          },
          bcc: {
            type: "array",
            description: "BCC email addresses (optional)",
            items: { type: "string" },
          },
          subject: { type: "string", description: "Email subject" },
          text: { type: "string", description: "Plain text email body" },
          html: { type: "string", description: "HTML email body (optional)" },
          replyToMessageId: {
            type: "string",
            description: "Message-ID to reply to (optional)",
          },
          previousDraftId: {
            type: "string",
            description:
              "Previous draft ID when revising a denied or corrected draft (optional)",
          },
        },
        required: ["to", "text"],
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      const parsed = emailDraftInputSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid email draft input");

      await connectDB();
      const account = await resolveSendingAccount(parsed.data.account);
      const previousDraftId =
        parsed.data.previousDraftId &&
        mongoose.Types.ObjectId.isValid(parsed.data.previousDraftId)
          ? new mongoose.Types.ObjectId(parsed.data.previousDraftId)
          : undefined;

      const draft = await EmailDraftModel.create({
        accountId: account._id,
        to: parsed.data.to,
        cc: parsed.data.cc,
        bcc: parsed.data.bcc,
        subject: parsed.data.subject,
        text: parsed.data.text,
        html: parsed.data.html,
        replyToMessageId: parsed.data.replyToMessageId,
        previousDraftId,
        status: "draft",
      });

      return {
        success: true,
        ...serializeEmailDraft(draft.toObject() as ILeanEmailDraft, account),
      };
    },
  },
  {
    schema: {
      name: "request_send_email",
      description:
        "Request approval to send a stored email draft. Only call this with a draftId returned by generate_email_draft. If the user denies approval, ask what should be corrected and generate a revised draft before requesting send again.",
      input_schema: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "Draft ID returned by generate_email_draft",
          },
        },
        required: ["draftId"],
      },
    },
    isWrite: true,
    category: "email",
    execute: async (input) => {
      const parsed = sendEmailDraftInputSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid email send request");

      await connectDB();
      const draft = await EmailDraftModel.findById(
        parsed.data.draftId,
      ).lean<ILeanEmailDraft | null>();
      if (!draft) throw new Error("Email draft not found");
      if (draft.status === "sent")
        throw new Error("Email draft was already sent");

      const account = await EmailAccountModel.findById(
        draft.accountId,
      ).lean<ILeanEmailAccount | null>();
      if (!account) throw new Error("Email account not found");

      await sendMailFromAccount(account, {
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        text: draft.text,
        html: draft.html,
        replyToMessageId: draft.replyToMessageId,
      });

      const sentAt = new Date();
      await EmailDraftModel.findByIdAndUpdate(draft._id, {
        status: "sent",
        sentAt,
      });

      return {
        success: true,
        draftId: draft._id.toString(),
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        sentAt: sentAt.toISOString(),
      };
    },
  },
];
