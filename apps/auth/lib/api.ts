import { rawRequest, requestData } from "@repo/cloud-ui/api-client";
import {
  type CompleteSignupInput,
  type CompleteSignupResult,
  type CreateOAuthClientInput,
  completeSignupResultSchema,
  type OAuthClientCredentials,
  type OAuthClientList,
  oauthClientCredentialsSchema,
  oauthClientListSchema,
  type SafeUser,
  safeUserSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";

export {
  ApiError,
  errorMessage,
  isApiError,
} from "@repo/cloud-ui/api-error";

const publicClientSchema = z.object({
  client_id: z.string(),
  client_name: z.string().optional(),
  client_uri: z.string().optional(),
  logo_uri: z.string().optional(),
});
export type PublicClient = z.infer<typeof publicClientSchema>;

const clientUpdateSchema = z.object({
  clientId: z.string(),
  disabled: z.boolean(),
});

function clientPath(clientId: string, suffix = ""): string {
  return `/api/oauth/clients/${encodeURIComponent(clientId)}${suffix}`;
}

export const api = {
  me: (): Promise<SafeUser> => requestData(safeUserSchema, "/api/me"),
  completeSignup: (input: CompleteSignupInput): Promise<CompleteSignupResult> =>
    requestData(completeSignupResultSchema, "/api/auth/complete-signup", {
      method: "POST",
      body: input,
    }),
  publicClient: async (clientId: string): Promise<PublicClient> =>
    publicClientSchema.parse(
      await rawRequest("/api/auth/oauth2/public-client", {
        query: { client_id: clientId },
      }),
    ),
  clients: (): Promise<OAuthClientList> =>
    requestData(oauthClientListSchema, "/api/oauth/clients"),
  createClient: (
    input: CreateOAuthClientInput,
  ): Promise<OAuthClientCredentials> =>
    requestData(oauthClientCredentialsSchema, "/api/oauth/clients", {
      method: "POST",
      body: input,
    }),
  rotateClientSecret: (clientId: string): Promise<OAuthClientCredentials> =>
    requestData(
      oauthClientCredentialsSchema,
      clientPath(clientId, "/rotate-secret"),
      { method: "POST" },
    ),
  setClientDisabled: (clientId: string, disabled: boolean) =>
    requestData(clientUpdateSchema, clientPath(clientId), {
      method: "PATCH",
      body: { disabled },
    }),
};
