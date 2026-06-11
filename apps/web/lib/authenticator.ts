import * as OTPAuth from "otpauth";
import {
  AuthenticatorAccount,
  type TotpAlgorithm,
} from "@/models/AuthenticatorAccount";
import { connectDB } from "./mongodb";
import { decryptPassword, encryptPassword } from "./safe-email-password";

const VALID_ALGORITHMS: Set<string> = new Set(["SHA1", "SHA256", "SHA512"]);

function isTotpAlgorithm(value: string): value is TotpAlgorithm {
  return VALID_ALGORITHMS.has(value);
}

function toPublicAccount(doc: {
  _id: { toString(): string };
  label: string;
  issuer: string;
  accountName: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    _id: doc._id.toString(),
    label: doc.label,
    issuer: doc.issuer,
    accountName: doc.accountName,
    algorithm: doc.algorithm,
    digits: doc.digits,
    period: doc.period,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function parseOtpAuthUri(uri: string) {
  const parsed = OTPAuth.URI.parse(uri);

  if (!(parsed instanceof OTPAuth.TOTP)) {
    throw new Error("Only TOTP URIs are supported");
  }

  const labelParts = parsed.label.split(":");
  const accountName =
    labelParts.length > 1 ? labelParts.slice(1).join(":").trim() : parsed.label;

  return {
    label: parsed.issuer || parsed.label.split(":")[0].trim(),
    issuer: parsed.issuer,
    accountName,
    secret: parsed.secret.base32,
    algorithm: isTotpAlgorithm(parsed.algorithm)
      ? parsed.algorithm
      : ("SHA1" as const),
    digits: parsed.digits || 6,
    period: parsed.period || 30,
  };
}

export async function getAllAccounts() {
  await connectDB();
  const accounts = await AuthenticatorAccount.find()
    .sort({ createdAt: -1 })
    .lean();
  return accounts.map(toPublicAccount);
}

export async function createAccount(data: {
  label: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm?: TotpAlgorithm;
  digits?: number;
  period?: number;
}) {
  await connectDB();
  const encrypted = encryptPassword(data.secret);
  const account = await AuthenticatorAccount.create({
    label: data.label,
    issuer: data.issuer,
    accountName: data.accountName,
    secret: encrypted,
    algorithm: data.algorithm ?? "SHA1",
    digits: data.digits ?? 6,
    period: data.period ?? 30,
  });
  return toPublicAccount(account);
}

export async function importAccounts(uris: string[]) {
  const imported: ReturnType<typeof toPublicAccount>[] = [];
  const errors: { uri: string; error: string }[] = [];

  for (const uri of uris) {
    try {
      const parsed = parseOtpAuthUri(uri.trim());
      const account = await createAccount(parsed);
      imported.push(account);
    } catch (error) {
      errors.push({
        uri: uri.substring(0, 80),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { imported, errors };
}

export async function generateCodes() {
  await connectDB();
  const accounts = await AuthenticatorAccount.find().lean();
  const now = Date.now();

  return accounts.map((account) => {
    const decryptedSecret = decryptPassword(
      account.secret.ciphertext,
      account.secret.iv,
      account.secret.authTag,
    );

    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(decryptedSecret),
      algorithm: account.algorithm,
      digits: account.digits,
      period: account.period,
    });

    const code = totp.generate();
    const elapsed = Math.floor(now / 1000) % account.period;
    const remaining = account.period - elapsed;

    return {
      _id: account._id.toString(),
      code,
      period: account.period,
      remaining,
    };
  });
}

export async function updateAccount(
  id: string,
  data: Partial<{ label: string; issuer: string; accountName: string }>,
) {
  await connectDB();
  const account = await AuthenticatorAccount.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
  }).lean();
  if (!account) return null;
  return toPublicAccount(account);
}

export async function deleteAccount(id: string) {
  await connectDB();
  const result = await AuthenticatorAccount.findByIdAndDelete(id);
  return !!result;
}
