import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { ILeanEmailAccount } from "@/models/EmailAccount";
import { decryptSecret } from "./encrypted-secret";

export type SmtpProvider = "custom" | "gmail" | "outlook" | "yahoo" | "icloud";

export const SMTP_PROVIDER_DEFAULTS: Record<
  Exclude<SmtpProvider, "custom">,
  {
    host: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
  }
> = {
  gmail: {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    requireTLS: false,
  },
  outlook: {
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: false,
    requireTLS: true,
  },
  yahoo: {
    host: "smtp.mail.yahoo.com",
    port: 465,
    secure: true,
    requireTLS: false,
  },
  icloud: {
    host: "smtp.mail.me.com",
    port: 587,
    secure: false,
    requireTLS: true,
  },
};

export interface SmtpConnectionSettings {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  pass: string;
}

export interface SmtpSendInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  replyToMessageId?: string;
  attachments?: SmtpAttachmentInput[];
}

export interface SmtpAttachmentInput {
  filename: string;
  content: Buffer;
  contentType?: string;
}

function providerDefaults(provider: SmtpProvider | undefined) {
  if (!provider || provider === "custom") return undefined;
  return SMTP_PROVIDER_DEFAULTS[provider];
}

export function resolveSmtpServerSettings(account: ILeanEmailAccount) {
  const defaults = providerDefaults(account.provider);
  const host = account.smtpHost ?? defaults?.host;
  const port = account.smtpPort ?? defaults?.port;
  const secure = account.smtpSecure ?? defaults?.secure ?? false;
  const requireTLS =
    account.smtpRequireTls ?? defaults?.requireTLS ?? port === 587;
  const user = account.smtpUser || account.user;
  const fromAddress = account.smtpFromAddress || account.user;

  if (!host || !port || !user || !fromAddress) return null;

  return {
    host,
    port,
    secure,
    requireTLS,
    user,
    fromName: account.smtpFromName,
    fromAddress,
  };
}

export function isSmtpConfigured(account: ILeanEmailAccount) {
  const settings = resolveSmtpServerSettings(account);
  return Boolean(
    settings && (account.smtpPassword || account.smtpPasswordSharedWithImap),
  );
}

function resolveSmtpPassword(account: ILeanEmailAccount) {
  if (account.smtpPassword) return decryptSecret(account.smtpPassword);
  if (account.smtpPasswordSharedWithImap)
    return decryptSecret(account.imapPassword);
  return null;
}

export function createSmtpTransport(settings: SmtpConnectionSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
  } satisfies SMTPTransport.Options);
}

export async function verifySmtpConnection(settings: SmtpConnectionSettings) {
  const transport = createSmtpTransport(settings);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

export async function sendMailFromAccount(
  account: ILeanEmailAccount,
  input: SmtpSendInput,
) {
  const settings = resolveSmtpServerSettings(account);
  const password = resolveSmtpPassword(account);
  if (!settings || !password) {
    throw new Error("SMTP is not configured for this account");
  }

  const transport = createSmtpTransport({ ...settings, pass: password });
  try {
    return await transport.sendMail({
      from: {
        name: settings.fromName,
        address: settings.fromAddress,
      },
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.text,
      html: input.html,
      inReplyTo: input.replyToMessageId,
      references: input.replyToMessageId ? [input.replyToMessageId] : undefined,
      attachments: input.attachments,
    });
  } finally {
    transport.close();
  }
}
