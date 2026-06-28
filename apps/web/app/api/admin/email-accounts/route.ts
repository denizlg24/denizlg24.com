import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createImapClient } from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { encryptPassword } from "@/lib/safe-email-password";
import {
  isSmtpConfigured,
  SMTP_PROVIDER_DEFAULTS,
  type SmtpProvider,
  verifySmtpConnection,
} from "@/lib/smtp";
import {
  EmailAccountModel,
  type ILeanEmailAccount,
} from "@/models/EmailAccount";

const providerSchema = z.enum([
  "custom",
  "gmail",
  "outlook",
  "yahoo",
  "icloud",
]);

const createAccountSchema = z.object({
  provider: providerSchema.optional().default("custom"),
  displayName: z.string().trim().max(120).optional(),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().email().max(320),
  password: z.string().min(1).max(1000),
  inboxName: z.string().trim().min(1).max(120).optional(),
  smtpHost: z.string().trim().min(1).max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpRequireTls: z.boolean().optional(),
  smtpUser: z.string().trim().email().max(320).optional(),
  smtpPassword: z.string().max(1000).optional(),
  useSameCredentialsForSending: z.boolean().optional().default(true),
  smtpFromName: z.string().trim().max(120).optional(),
  smtpFromAddress: z.string().trim().email().max(320).optional(),
});

const IMAP_PROVIDER_DEFAULTS: Record<
  Exclude<SmtpProvider, "custom">,
  { host: string; port: number; secure: boolean }
> = {
  gmail: { host: "imap.gmail.com", port: 993, secure: true },
  outlook: { host: "outlook.office365.com", port: 993, secure: true },
  yahoo: { host: "imap.mail.yahoo.com", port: 993, secure: true },
  icloud: { host: "imap.mail.me.com", port: 993, secure: true },
};

function getSmtpDefaults(provider: SmtpProvider) {
  if (provider === "custom") return undefined;
  return SMTP_PROVIDER_DEFAULTS[provider];
}

function serializeEmailAccount(account: ILeanEmailAccount) {
  const {
    imapPassword: _imapPassword,
    smtpPassword: _smtpPassword,
    ...safe
  } = account;
  return {
    ...safe,
    _id: account._id.toString(),
    smtpConfigured: isSmtpConfigured(account),
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const accounts = await EmailAccountModel.find().lean<ILeanEmailAccount[]>();

    return NextResponse.json(
      {
        accounts: accounts.map(serializeEmailAccount),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching email accounts:", error);
    return NextResponse.json(
      { error: "Failed to fetch email accounts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const parsed = createAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid email account settings" },
        { status: 400 },
      );
    }

    const {
      provider,
      displayName,
      user,
      password,
      inboxName,
      useSameCredentialsForSending,
    } = parsed.data;
    const imapDefaults =
      provider === "custom" ? undefined : IMAP_PROVIDER_DEFAULTS[provider];
    const host = parsed.data.host || imapDefaults?.host;
    const port = parsed.data.port || imapDefaults?.port;
    const secure = parsed.data.secure ?? imapDefaults?.secure ?? true;

    if (!host || !port) {
      return NextResponse.json(
        { error: "Missing required IMAP settings" },
        { status: 400 },
      );
    }

    try {
      const client = await createImapClient({
        host,
        port,
        secure,
        user,
        pass: password,
      });

      await client.mailboxOpen(inboxName || "INBOX");
      await client.logout();
    } catch (connectionError) {
      console.error("IMAP connection test failed");
      return NextResponse.json(
        {
          error:
            "Failed to connect to email server. Please check your credentials.",
        },
        { status: 400 },
      );
    }

    const smtpDefaults = getSmtpDefaults(provider);
    const smtpHost = parsed.data.smtpHost ?? smtpDefaults?.host;
    const smtpPort = parsed.data.smtpPort ?? smtpDefaults?.port;
    const smtpSecure =
      parsed.data.smtpSecure ?? smtpDefaults?.secure ?? undefined;
    const smtpRequireTls =
      parsed.data.smtpRequireTls ?? smtpDefaults?.requireTLS ?? undefined;
    const smtpUser = parsed.data.smtpUser || user;
    const smtpFromAddress = parsed.data.smtpFromAddress || user;
    const hasSmtpSettings = Boolean(smtpHost || smtpPort);
    const smtpPassword = useSameCredentialsForSending
      ? password
      : parsed.data.smtpPassword;

    if (hasSmtpSettings) {
      if (!smtpHost || !smtpPort || !smtpPassword) {
        return NextResponse.json(
          { error: "Missing required SMTP settings" },
          { status: 400 },
        );
      }

      try {
        await verifySmtpConnection({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure ?? false,
          requireTLS: smtpRequireTls ?? smtpPort === 587,
          user: smtpUser,
          pass: smtpPassword,
        });
      } catch {
        console.error("SMTP connection test failed");
        return NextResponse.json(
          {
            error:
              "Failed to verify SMTP sending. Check the SMTP server, port, and credentials.",
          },
          { status: 400 },
        );
      }
    }

    const encryptedPassword = encryptPassword(password);
    const encryptedSmtpPassword =
      hasSmtpSettings &&
      !useSameCredentialsForSending &&
      parsed.data.smtpPassword
        ? encryptPassword(parsed.data.smtpPassword)
        : undefined;

    await connectDB();

    const existingAccount = await EmailAccountModel.findOne({ user, host });
    if (existingAccount) {
      return NextResponse.json(
        { error: "An account with this email and host already exists" },
        { status: 400 },
      );
    }

    const account = await EmailAccountModel.create({
      provider,
      displayName,
      host,
      port,
      secure,
      user,
      imapPassword: encryptedPassword,
      inboxName: inboxName || "INBOX",
      lastUid: 0,
      ...(hasSmtpSettings
        ? {
            smtpHost,
            smtpPort,
            smtpSecure,
            smtpRequireTls,
            smtpUser,
            smtpPassword: encryptedSmtpPassword,
            smtpPasswordSharedWithImap: useSameCredentialsForSending,
            smtpFromName: parsed.data.smtpFromName,
            smtpFromAddress,
            lastSmtpTestAt: new Date(),
            lastSmtpError: undefined,
          }
        : {}),
    });

    revalidatePath("/admin/dashboard/inbox");

    return NextResponse.json(
      {
        message: "Email account added successfully",
        account: serializeEmailAccount(account.toObject() as ILeanEmailAccount),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating email account:", error);
    return NextResponse.json(
      { error: "Failed to create email account" },
      { status: 500 },
    );
  }
}
