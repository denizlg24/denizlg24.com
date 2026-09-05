import { decryptSecret, type EncryptedSecret } from "./encrypted-secret";
import { connectResourceDB } from "./mongodb-resource";

export const DR_DEEP_HEALTH_URL = "https://api.denizlg24.com/healthz/deep";

/** Named credentials never contain secrets in resource documents or URLs. */
export async function healthCheckHeaders(
  url: string,
  credentialId?: string | null,
): Promise<Record<string, string>> {
  if (!credentialId) return {};
  if (credentialId !== "dr-synthetic" || url !== DR_DEEP_HEALTH_URL) {
    throw new Error("Health credential is not allowed for this endpoint");
  }
  const db = await connectResourceDB();
  const credential = await db
    .collection<{ _id: string; secret: EncryptedSecret }>(
      "healthcheckcredentials",
    )
    .findOne({ _id: credentialId });
  if (!credential) throw new Error("Health check credential is missing");
  return { "X-DR-Synthetic-Token": decryptSecret(credential.secret) };
}
