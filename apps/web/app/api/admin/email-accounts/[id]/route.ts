import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { decryptSecret } from "@/lib/encrypted-secret";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { encryptPassword } from "@/lib/safe-email-password";
import {
  isSmtpConfigured,
  SMTP_PROVIDER_DEFAULTS,
  type SmtpProvider,
  verifySmtpConnection,
} from "@/lib/smtp";
import { EmailModel } from "@/models/Email";
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

const updateAccountSchema = z.object({
  provider: providerSchema.optional(),
  displayName: z.string().trim().max(120).optional(),
  host: z.string().trim().min(1).max(255).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().trim().email().max(320).optional(),
  inboxName: z.string().trim().min(1).max(120).optional(),
  smtpHost: z.string().trim().min(1).max(255).optional(),
  smtpPort: z.coerce.number().int().min(1).max(65535).optional(),
  smtpSecure: z.boolean().optional(),
  smtpRequireTls: z.boolean().optional(),
  smtpUser: z.string().trim().email().max(320).optional(),
  smtpPassword: z.string().max(1000).optional(),
  useSameCredentialsForSending: z.boolean().optional(),
  smtpFromName: z.string().trim().max(120).optional(),
  smtpFromAddress: z.string().trim().email().max(320).optional(),
});

function getSmtpDefaults(provider: SmtpProvider | undefined) {
  if (!provider || provider === "custom") return undefined;
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

function resolveExistingSmtpPassword(account: ILeanEmailAccount) {
  if (account.smtpPassword) return decryptSecret(account.smtpPassword);
  if (account.smtpPasswordSharedWithImap) {
    return decryptSecret(account.imapPassword);
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const parsed = updateAccountSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid email account settings" },
        { status: 400 },
      );
    }

    const { id } = await params;
    await connectDB();
    const account = await EmailAccountModel.findById(
      id,
    ).lean<ILeanEmailAccount | null>();
    if (!account) {
      return NextResponse.json(
        { error: "Email account not found" },
        { status: 404 },
      );
    }

    const provider = parsed.data.provider ?? account.provider ?? "custom";
    const smtpDefaults = getSmtpDefaults(provider);
    const user = parsed.data.user ?? account.user;
    const smtpHost =
      parsed.data.smtpHost ?? account.smtpHost ?? smtpDefaults?.host;
    const smtpPort =
      parsed.data.smtpPort ?? account.smtpPort ?? smtpDefaults?.port;
    const smtpSecure =
      parsed.data.smtpSecure ?? account.smtpSecure ?? smtpDefaults?.secure;
    const smtpRequireTls =
      parsed.data.smtpRequireTls ??
      account.smtpRequireTls ??
      smtpDefaults?.requireTLS;
    const smtpUser = parsed.data.smtpUser ?? account.smtpUser ?? user;
    const smtpFromAddress =
      parsed.data.smtpFromAddress ?? account.smtpFromAddress ?? user;
    const useSameCredentialsForSending =
      parsed.data.useSameCredentialsForSending ??
      account.smtpPasswordSharedWithImap ??
      false;
    const hasProvidedSmtpSettings = Boolean(
      parsed.data.smtpHost !== undefined ||
        parsed.data.smtpPort !== undefined ||
        parsed.data.smtpSecure !== undefined ||
        parsed.data.smtpRequireTls !== undefined ||
        parsed.data.smtpUser !== undefined ||
        parsed.data.smtpPassword !== undefined ||
        parsed.data.useSameCredentialsForSending !== undefined ||
        parsed.data.smtpFromName !== undefined ||
        parsed.data.smtpFromAddress !== undefined,
    );

    let smtpPasswordForVerify: string | null = null;
    if (hasProvidedSmtpSettings) {
      if (!smtpHost || !smtpPort) {
        return NextResponse.json(
          { error: "Missing required SMTP settings" },
          { status: 400 },
        );
      }

      if (useSameCredentialsForSending) {
        smtpPasswordForVerify = decryptSecret(account.imapPassword);
      } else if (parsed.data.smtpPassword) {
        smtpPasswordForVerify = parsed.data.smtpPassword;
      } else {
        smtpPasswordForVerify = resolveExistingSmtpPassword(account);
      }

      if (!smtpPasswordForVerify) {
        return NextResponse.json(
          { error: "SMTP password is required to enable sending" },
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
          pass: smtpPasswordForVerify,
        });
      } catch {
        console.error("SMTP connection test failed");
        await EmailAccountModel.findByIdAndUpdate(id, {
          $set: {
            lastSmtpError:
              "Failed to verify SMTP sending. Check the SMTP server, port, and credentials.",
          },
        });
        return NextResponse.json(
          {
            error:
              "Failed to verify SMTP sending. Check the SMTP server, port, and credentials.",
          },
          { status: 400 },
        );
      }
    }

    const $set: Record<string, unknown> = {
      provider,
      ...(parsed.data.displayName !== undefined
        ? { displayName: parsed.data.displayName }
        : {}),
      ...(parsed.data.host !== undefined ? { host: parsed.data.host } : {}),
      ...(parsed.data.port !== undefined ? { port: parsed.data.port } : {}),
      ...(parsed.data.secure !== undefined
        ? { secure: parsed.data.secure }
        : {}),
      ...(parsed.data.user !== undefined ? { user: parsed.data.user } : {}),
      ...(parsed.data.inboxName !== undefined
        ? { inboxName: parsed.data.inboxName }
        : {}),
      ...(hasProvidedSmtpSettings
        ? {
            smtpHost,
            smtpPort,
            smtpSecure,
            smtpRequireTls,
            smtpUser,
            smtpFromName: parsed.data.smtpFromName ?? account.smtpFromName,
            smtpFromAddress,
            smtpPasswordSharedWithImap: useSameCredentialsForSending,
            lastSmtpTestAt: new Date(),
          }
        : {}),
    };
    const $unset: Record<string, ""> = { lastSmtpError: "" };

    if (hasProvidedSmtpSettings && useSameCredentialsForSending) {
      $unset.smtpPassword = "";
    } else if (hasProvidedSmtpSettings && parsed.data.smtpPassword) {
      $set.smtpPassword = encryptPassword(parsed.data.smtpPassword);
    }

    const updated = await EmailAccountModel.findByIdAndUpdate(
      id,
      { $set, $unset },
      { returnDocument: "after" },
    ).lean<ILeanEmailAccount | null>();

    if (!updated) {
      return NextResponse.json(
        { error: "Email account not found" },
        { status: 404 },
      );
    }

    revalidatePath("/admin/dashboard/inbox");

    return NextResponse.json(
      {
        message: "Email account updated successfully",
        account: serializeEmailAccount(updated),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating email account:", error);
    return NextResponse.json(
      { error: "Failed to update email account" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await connectDB();

    await EmailModel.deleteMany({ accountId: id });

    const account = await EmailAccountModel.findByIdAndDelete(id);

    if (!account) {
      return NextResponse.json(
        { error: "Email account not found" },
        { status: 404 },
      );
    }

    revalidatePath("/admin/dashboard/inbox");

    return NextResponse.json(
      { message: "Email account deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting email account:", error);
    return NextResponse.json(
      { error: "Failed to delete email account" },
      { status: 500 },
    );
  }
}
