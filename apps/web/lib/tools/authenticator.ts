import {
  createAccount,
  deleteAccount,
  generateCodes,
  getAllAccounts,
  updateAccount,
} from "@/lib/authenticator";
import type { ToolDefinition } from "./types";

/**
 * TOTP vault.
 *
 * There is deliberately no tool over `GET /authenticator/export`. That route is
 * the only one that returns decrypted base32 secrets, and it exists so the
 * browser extension can hold an offline vault. A secret is the credential
 * itself, where a code is a 30-second derivative of it, so exposing the export
 * to a model would put every secret one prompt injection away from exfiltration
 * for no capability the code tool does not already provide.
 *
 * A secret is likewise never updatable in place: rotating one means deleting
 * the account and adding it again, which is what the provider makes you do too.
 */

export const authenticatorTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_authenticator_accounts",
      description:
        "TOTP accounts in the vault. Never includes secrets — use get_authenticator_codes for current codes.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "authenticator",
    execute: async () => ({ accounts: await getAllAccounts() }),
  },
  {
    schema: {
      name: "get_authenticator_codes",
      description:
        "Current TOTP codes for every account, with the seconds remaining before each rolls. Codes are computed server-side; the underlying secrets are never returned.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "authenticator",
    execute: async () => ({ codes: await generateCodes() }),
  },
  {
    schema: {
      name: "create_authenticator_account",
      description:
        "Add a TOTP account. The secret is the base32 string from the provider; it is encrypted at rest and never returned again.",
      input_schema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Name shown in the vault." },
          issuer: { type: "string", description: "Service, e.g. GitHub." },
          accountName: {
            type: "string",
            description: "Account at that service, usually an email.",
          },
          secret: { type: "string", description: "Base32 TOTP secret." },
          algorithm: {
            type: "string",
            description:
              "Defaults to SHA1, which is what almost everything uses.",
            enum: ["SHA1", "SHA256", "SHA512"],
          },
          digits: {
            type: "number",
            description: "Code length, default 6.",
            minimum: 6,
            maximum: 8,
          },
          period: {
            type: "number",
            description: "Seconds per code, default 30.",
            minimum: 15,
            maximum: 120,
          },
        },
        required: ["label", "issuer", "accountName", "secret"],
      },
    },
    isWrite: true,
    category: "authenticator",
    execute: async (input) =>
      createAccount({
        label: String(input.label ?? ""),
        issuer: String(input.issuer ?? ""),
        accountName: String(input.accountName ?? ""),
        secret: String(input.secret ?? ""),
        algorithm: input.algorithm as "SHA1" | "SHA256" | "SHA512" | undefined,
        digits: input.digits as number | undefined,
        period: input.period as number | undefined,
      }),
  },
  {
    schema: {
      name: "update_authenticator_account",
      description:
        "Rename an account or correct its issuer. The secret cannot be changed in place — delete the account and add it again to rotate one.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Account id." },
          label: { type: "string", description: "New label." },
          issuer: { type: "string", description: "New issuer." },
          accountName: { type: "string", description: "New account name." },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "authenticator",
    execute: async (input) => {
      const patch: Partial<{
        label: string;
        issuer: string;
        accountName: string;
      }> = {};
      if (input.label !== undefined) patch.label = String(input.label);
      if (input.issuer !== undefined) patch.issuer = String(input.issuer);
      if (input.accountName !== undefined) {
        patch.accountName = String(input.accountName);
      }
      if (Object.keys(patch).length === 0) {
        throw new Error("Pass at least one of label, issuer or accountName");
      }
      const account = await updateAccount(String(input.id ?? ""), patch);
      if (!account) throw new Error("Account not found");
      return account;
    },
  },
  {
    schema: {
      name: "delete_authenticator_account",
      description:
        "Remove a TOTP account. The secret is unrecoverable afterwards — confirm before calling.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Account id." } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "authenticator",
    execute: async (input) => {
      const deleted = await deleteAccount(String(input.id ?? ""));
      if (!deleted) throw new Error("Account not found");
      return { success: true };
    },
  },
];
