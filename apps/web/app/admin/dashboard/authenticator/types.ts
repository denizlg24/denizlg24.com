export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface IAuthenticatorAccount {
  _id: string;
  label: string;
  issuer: string;
  accountName: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  createdAt: string;
  updatedAt: string;
}

export interface IAuthenticatorCode {
  _id: string;
  code: string;
  period: number;
  remaining: number;
}
