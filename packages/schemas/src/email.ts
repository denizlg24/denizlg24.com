import { z } from "zod";

export const emailSchema = z.object({
  _id: z.string(),
  accountId: z.string(),
  messageId: z.string(),
  subject: z.string(),
  from: z.array(
    z.object({
      name: z.string().optional(),
      address: z.string(),
    }),
  ),
  date: z.string(),
  seen: z.boolean(),
  uid: z.number(),
});
export type IEmail = z.infer<typeof emailSchema>;

export const emailProviderSchema = z.enum([
  "custom",
  "gmail",
  "outlook",
  "yahoo",
  "icloud",
]);

export const emailAccountSchema = z.object({
  _id: z.string(),
  provider: emailProviderSchema.optional(),
  displayName: z.string().optional(),
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string(),
  inboxName: z.string(),
  lastUid: z.number(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().optional(),
  smtpSecure: z.boolean().optional(),
  smtpRequireTls: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPasswordSharedWithImap: z.boolean().optional(),
  smtpFromName: z.string().optional(),
  smtpFromAddress: z.string().optional(),
  smtpConfigured: z.boolean().optional(),
  lastSmtpTestAt: z.string().optional(),
  lastSmtpError: z.string().optional(),
  emails: z.array(emailSchema).optional(),
});
export type IEmailAccount = z.infer<typeof emailAccountSchema>;

export const fullEmailSchema = emailSchema.extend({
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
});
export type IFullEmail = z.infer<typeof fullEmailSchema>;

export const emailAttachmentSchema = z.object({
  index: z.number(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
});
export type IEmailAttachment = z.infer<typeof emailAttachmentSchema>;

export const EMAIL_QUERY_LIMIT = 20;
export const EMAIL_QUERY_CANDIDATE_LIMIT = 500;

/** A live IMAP search across one or every account; nothing here reads the local store. */
export const emailQuerySchema = z
  .object({
    account: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .optional()
      .describe("Account _id, address or display name; omit for every account"),
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Full-text search across headers and body"),
    from: z.string().trim().min(1).max(320).optional(),
    to: z.string().trim().min(1).max(320).optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    startDate: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid start date")
      .optional()
      .describe("Inclusive received date, ISO 8601"),
    endDate: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid end date")
      .optional()
      .describe("Exclusive received date, ISO 8601"),
    unreadOnly: z.boolean().default(false),
    scope: z
      .enum(["all", "inbox"])
      .default("all")
      .describe("all searches the All Mail folder when the server exposes one"),
    includeBody: z.boolean().default(false),
    limit: z.number().int().min(1).max(EMAIL_QUERY_LIMIT).default(20),
    offset: z
      .number()
      .int()
      .min(0)
      .max(EMAIL_QUERY_CANDIDATE_LIMIT)
      .default(0)
      .describe("Use nextOffset to continue"),
  })
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      Date.parse(value.startDate) < Date.parse(value.endDate),
    { message: "endDate must be after startDate", path: ["endDate"] },
  );
export type EmailQuery = z.infer<typeof emailQuerySchema>;
