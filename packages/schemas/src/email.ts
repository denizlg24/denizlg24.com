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

export const emailAccountSchema = z.object({
  _id: z.string(),
  host: z.string(),
  port: z.number(),
  secure: z.boolean(),
  user: z.string(),
  imapPassword: z.object({
    ciphertext: z.string(),
    iv: z.string(),
    authTag: z.string(),
  }),
  inboxName: z.string(),
  lastUid: z.number(),
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
