import { z } from "zod";

export const totpAlgorithmSchema = z.enum(["SHA1", "SHA256", "SHA512"]);
export type TotpAlgorithm = z.infer<typeof totpAlgorithmSchema>;

export const authenticatorAccountSchema = z.object({
  _id: z.string(),
  label: z.string(),
  issuer: z.string(),
  accountName: z.string(),
  algorithm: totpAlgorithmSchema,
  digits: z.number(),
  period: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IAuthenticatorAccount = z.infer<typeof authenticatorAccountSchema>;

export const authenticatorCodeSchema = z.object({
  _id: z.string(),
  code: z.string(),
  period: z.number(),
  remaining: z.number(),
});
export type IAuthenticatorCode = z.infer<typeof authenticatorCodeSchema>;

/** An account plus its plaintext base32 secret. Only ever crosses the wire on
 *  `GET /api/admin/authenticator/export`, which the browser extension calls to
 *  seed its offline vault. Nothing else should request or persist this shape. */
export const authenticatorExportAccountSchema =
  authenticatorAccountSchema.extend({
    secret: z.string(),
  });
export type IAuthenticatorExportAccount = z.infer<
  typeof authenticatorExportAccountSchema
>;

export const authenticatorExportSchema = z.object({
  accounts: z.array(authenticatorExportAccountSchema),
  exportedAt: z.string(),
});
export type IAuthenticatorExport = z.infer<typeof authenticatorExportSchema>;
