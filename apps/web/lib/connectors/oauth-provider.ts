import { createHash, randomBytes } from "node:crypto";
import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { siteResourceConfig } from "@/lib/cloud-oauth";
import { decryptSecret, encryptSecret } from "@/lib/encrypted-secret";
import {
  Connector,
  type IConnector,
  type IConnectorOAuth,
  type IConnectorOAuthClient,
} from "@/models/Connector";

const STATE_TTL_MS = 10 * 60_000;

export function connectorOAuthRedirectUrl(): string {
  const site = (
    process.env.WEB_PUBLIC_URL ?? siteResourceConfig().resource
  ).replace(/\/$/, "");
  return `${site}/api/connectors/oauth/callback`;
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function sealJson(value: unknown) {
  return encryptSecret(JSON.stringify(value));
}

function openJson<T>(sealed: IConnectorOAuth["tokens"]): T | undefined {
  if (!sealed) return undefined;
  return JSON.parse(decryptSecret(sealed)) as T;
}

/**
 * MCP authorization state for one connector, persisted on its row. The
 * authorization URL is captured rather than followed: the owner opens it in a
 * browser, and the callback route finishes the exchange with a fresh provider
 * built from the verified `state`.
 */
export class ConnectorOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;
  private readonly connectorId: string;
  private oauth: IConnectorOAuth;
  private readonly registeredClient?: IConnectorOAuthClient;

  constructor(
    connector: Pick<IConnector, "_id" | "oauth" | "oauthClient">,
    private readonly verifiedState?: string,
  ) {
    this.connectorId = connector._id.toString();
    this.oauth = connector.oauth ?? {};
    this.registeredClient = connector.oauthClient;
  }

  /** The scope to request, when the owner narrowed it on the client. */
  get scope(): string | undefined {
    return this.registeredClient?.scope;
  }

  get redirectUrl(): string {
    return connectorOAuthRedirectUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "denizlg24",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    };
  }

  private async persist(patch: Partial<IConnectorOAuth>) {
    this.oauth = { ...this.oauth, ...patch };
    const set: Record<string, unknown> = {};
    const unset: Record<string, 1> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) unset[`oauth.${key}`] = 1;
      else set[`oauth.${key}`] = value;
    }
    await Connector.updateOne(
      { _id: this.connectorId },
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
    );
  }

  tokens(): OAuthTokens | undefined {
    return openJson<OAuthTokens>(this.oauth.tokens);
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.persist({ tokens: sealJson(tokens) });
    await Connector.updateOne(
      { _id: this.connectorId },
      { $set: { status: "ready" }, $unset: { statusDetail: 1 } },
    );
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.persist({ codeVerifier: encryptSecret(codeVerifier) });
  }

  codeVerifier(): string {
    if (!this.oauth.codeVerifier) {
      throw new Error("No authorization is in progress for this connector");
    }
    return decryptSecret(this.oauth.codeVerifier);
  }

  /** A hand-registered client wins, which is what skips dynamic registration. */
  clientInformation(): OAuthClientInformation | undefined {
    if (this.registeredClient) {
      const { clientId, clientSecret } = this.registeredClient;
      return {
        client_id: clientId,
        ...(clientSecret ? { client_secret: decryptSecret(clientSecret) } : {}),
      };
    }
    return openJson<OAuthClientInformation>(this.oauth.clientInformation);
  }

  async saveClientInformation(
    clientInformation: OAuthClientInformation,
  ): Promise<void> {
    await this.persist({ clientInformation: sealJson(clientInformation) });
  }

  authorizationServerInformation():
    | OAuthAuthorizationServerInformation
    | undefined {
    return this.oauth.authorizationServer;
  }

  async saveAuthorizationServerInformation(
    information: OAuthAuthorizationServerInformation,
  ): Promise<void> {
    await this.persist({
      authorizationServer: {
        ...(information.issuer ? { issuer: information.issuer } : {}),
        authorizationServerUrl: information.authorizationServerUrl,
        tokenEndpoint: information.tokenEndpoint,
      },
    });
  }

  state(): string {
    return randomBytes(32).toString("base64url");
  }

  async saveState(state: string): Promise<void> {
    await this.persist({
      stateHash: hashOAuthState(state),
      stateExpiresAt: new Date(Date.now() + STATE_TTL_MS),
    });
  }

  storedState(): string | undefined {
    return this.verifiedState;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier",
  ): Promise<void> {
    if (scope === "all") {
      await this.persist({
        clientInformation: undefined,
        tokens: undefined,
        codeVerifier: undefined,
        authorizationServer: undefined,
      });
    } else if (scope === "client") {
      await this.persist({ clientInformation: undefined });
    } else if (scope === "tokens") {
      await this.persist({ tokens: undefined });
    } else {
      await this.persist({ codeVerifier: undefined });
    }
  }
}
