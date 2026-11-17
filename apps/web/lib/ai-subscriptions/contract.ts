import type { ChatgptCredential } from "@repo/schemas";
import { z } from "zod";

export {
  type ChatgptCredential,
  chatgptCredentialSchema,
  type SubscriptionProvider,
  subscriptionProviderSchema,
  subscriptionUpdateSchema,
} from "@repo/schemas";

export const chatgptTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  id_token: z.string().min(1).optional(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1),
});

export function credentialExpiresAt(record: ChatgptCredential): Date {
  return new Date(Date.parse(record.saved_at) + record.expires_in * 1000);
}
