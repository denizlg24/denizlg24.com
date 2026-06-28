import {
  decryptSecret,
  type EncryptedSecret,
  encryptSecret,
} from "./encrypted-secret";

export type { EncryptedSecret };

export const encryptPassword = encryptSecret;

export function decryptPassword(
  ciphertext: string,
  iv: string,
  authTag: string,
) {
  return decryptSecret({ ciphertext, iv, authTag });
}
