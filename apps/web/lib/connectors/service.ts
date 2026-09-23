import { createHash } from "node:crypto";
import { auth, createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import {
  type ConnectorAuthorizeResponse,
  type Connector as ConnectorDto,
  type ConnectorOAuthClientInput,
  type ConnectorTool,
  type CreateConnectorInput,
  MCP_ACTIONS_META_KEY,
  mcpActionsMetaSchema,
  PRIMARY_CONNECTOR_SLUG,
  type UpdateConnectorInput,
} from "@repo/schemas";
import type { JSONSchema7 } from "ai";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "@/lib/encrypted-secret";
import { connectDB } from "@/lib/mongodb";
import {
  Connector,
  type IConnector,
  type IConnectorOAuthClient,
} from "@/models/Connector";
import { ConnectorOAuthProvider, hashOAuthState } from "./oauth-provider";
import {
  PrimaryConnectorUnavailableError,
  primaryConnectorConfig,
  primaryConnectorFetch,
} from "./primary";

const CONNECT_TIMEOUT_MS = 15_000;
const MAX_TOOL_PAGES = 20;
const FAILED_REFRESH_RETRY_MS = 30 * 60_000;
let connectorStorageReady: Promise<void> | null = null;

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ConnectorError";
  }
}

function isObjectJsonSchema(value: unknown): value is JSONSchema7 {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "object"
  );
}

const mcpToolDefinitionSchema = z.looseObject({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  inputSchema: z.custom<JSONSchema7>(isObjectJsonSchema),
  annotations: z
    .looseObject({
      title: z.string().optional(),
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
    })
    .optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});
export type McpToolDefinition = z.infer<typeof mcpToolDefinitionSchema>;

/** Cached definitions as the turn builder reads them; junk rows are dropped. */
export function cachedToolDefinitions(
  connector: Pick<IConnector, "toolCache">,
): McpToolDefinition[] {
  const definitions: McpToolDefinition[] = [];
  for (const raw of connector.toolCache?.definitions ?? []) {
    const parsed = mcpToolDefinitionSchema.safeParse(raw);
    if (parsed.success) definitions.push(parsed.data);
  }
  return definitions;
}

export function describeToolDefinition(
  definition: McpToolDefinition,
): ConnectorTool {
  const actions = mcpActionsMetaSchema.safeParse(
    definition._meta?.[MCP_ACTIONS_META_KEY],
  );
  return {
    name: definition.name,
    ...(definition.title || definition.annotations?.title
      ? { title: definition.title ?? definition.annotations?.title }
      : {}),
    ...(definition.description ? { description: definition.description } : {}),
    readOnly: definition.annotations?.readOnlyHint === true,
    destructive: definition.annotations?.destructiveHint === true,
    ...(actions.success ? { actions: actions.data } : {}),
  };
}

export function serializeConnector(connector: IConnector): ConnectorDto {
  return {
    id: connector._id.toString(),
    slug: connector.slug,
    name: connector.name,
    url: connector.url,
    auth: connector.auth,
    approval: connector.approval,
    enabled: connector.enabled,
    disabledTools: connector.disabledTools,
    status: connector.status,
    statusDetail: connector.statusDetail ?? null,
    toolCount: connector.toolCache?.definitions.length ?? 0,
    builtIn: connector.builtIn,
    hasSecret: Boolean(connector.secret ?? connector.oauth?.tokens),
    oauthClient: connector.oauthClient
      ? {
          clientId: connector.oauthClient.clientId,
          scope: connector.oauthClient.scope ?? null,
          hasSecret: Boolean(connector.oauthClient.clientSecret),
        }
      : null,
    lastCheckedAt: connector.lastCheckedAt?.toISOString() ?? null,
    createdAt: connector.createdAt.toISOString(),
    updatedAt: connector.updatedAt.toISOString(),
  };
}

function primaryConnectorQuality(connector: IConnector): number {
  return (
    Number(connector.builtIn) * 1_000_000 +
    Number(connector.status === "ready") * 100_000 +
    (connector.toolCache?.definitions.length ?? 0) * 10 +
    (connector.lastCheckedAt?.getTime() ?? 0) / 1e13
  );
}

/** Repairs the pre-index first-request race from the original implementation. */
async function removeDuplicatePrimaryConnectors(): Promise<void> {
  const matches = await Connector.find({ slug: PRIMARY_CONNECTOR_SLUG });
  if (matches.length < 2) return;
  const [keep, ...duplicates] = matches.sort((left, right) => {
    const quality =
      primaryConnectorQuality(right) - primaryConnectorQuality(left);
    return quality || left._id.toString().localeCompare(right._id.toString());
  });
  if (!keep || duplicates.length === 0) return;
  await Connector.deleteMany({
    _id: { $in: duplicates.map((connector) => connector._id) },
  });
}

function ensureConnectorStorage(): Promise<void> {
  connectorStorageReady ??= (async () => {
    await removeDuplicatePrimaryConnectors();
    // Web and desktop can load this route together. Build the unique slug index
    // before either process performs the first upsert.
    await Connector.createIndexes();
  })().catch((error) => {
    connectorStorageReady = null;
    throw error;
  });
  return connectorStorageReady;
}

/**
 * The primary connector is a row like any other so its policy, toggles and
 * tool cache live in one place, but its URL and credentials come from the
 * environment and are re-read on every call.
 */
export async function ensurePrimaryConnector(): Promise<IConnector> {
  await connectDB();
  await ensureConnectorStorage();
  const config = primaryConnectorConfig();
  const connector = await Connector.findOneAndUpdate(
    { slug: PRIMARY_CONNECTOR_SLUG },
    {
      $set: { url: config.url, auth: "service", builtIn: true },
      $setOnInsert: {
        name: "denizlg24",
        approval: "reads-auto",
        enabled: true,
        disabledTools: [],
        status: config.credentials ? "error" : "unconfigured",
        ...(config.credentials
          ? { statusDetail: "Not checked yet" }
          : {
              statusDetail:
                "WEB_MCP_OAUTH_CLIENT_ID / WEB_MCP_OAUTH_CLIENT_SECRET are not set",
            }),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!connector) throw new Error("Primary connector could not be seeded");
  const checkedAt = connector.lastCheckedAt?.getTime() ?? 0;
  if (
    config.credentials &&
    !connector.toolCache &&
    Date.now() - checkedAt >= FAILED_REFRESH_RETRY_MS
  ) {
    return refreshConnectorTools(connector);
  }
  return connector;
}

export async function listConnectors(): Promise<IConnector[]> {
  await ensurePrimaryConnector();
  return Connector.find().sort({ builtIn: -1, createdAt: 1 });
}

export async function getConnector(id: string): Promise<IConnector> {
  await connectDB();
  const connector = await Connector.findById(id);
  if (!connector) throw new ConnectorError("Connector not found", 404);
  return connector;
}

function storedOAuthClient(
  input: ConnectorOAuthClientInput,
  current: IConnectorOAuthClient | undefined,
): IConnectorOAuthClient {
  const clientSecret = input.clientSecret
    ? encryptSecret(input.clientSecret)
    : input.clientId === current?.clientId
      ? current.clientSecret
      : undefined;
  return {
    clientId: input.clientId,
    ...(clientSecret ? { clientSecret } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
  };
}

function oauthClientChanged(
  current: IConnectorOAuthClient | undefined,
  input: ConnectorOAuthClientInput | null,
): boolean {
  if (!input) return current !== undefined;
  return (
    input.clientSecret !== undefined ||
    input.clientId !== current?.clientId ||
    input.scope !== current?.scope
  );
}

export async function createConnector(
  input: CreateConnectorInput,
): Promise<IConnector> {
  await connectDB();
  if (input.slug === PRIMARY_CONNECTOR_SLUG) {
    throw new ConnectorError("That slug is reserved", 409);
  }
  if (await Connector.exists({ slug: input.slug })) {
    throw new ConnectorError("A connector with that slug exists", 409);
  }
  const connector = await Connector.create({
    slug: input.slug,
    name: input.name,
    url: input.url,
    auth: input.auth,
    approval: input.approval,
    enabled: true,
    disabledTools: [],
    builtIn: false,
    ...(input.auth === "bearer" ? { secret: encryptSecret(input.token) } : {}),
    ...(input.auth === "oauth" ? { oauth: {} } : {}),
    ...(input.auth === "oauth" && input.oauthClient
      ? { oauthClient: storedOAuthClient(input.oauthClient, undefined) }
      : {}),
    status: input.auth === "oauth" ? "needs-auth" : "error",
    statusDetail: input.auth === "oauth" ? "Not authorized" : "Not checked yet",
  });
  if (input.auth !== "oauth") return refreshConnectorTools(connector);
  return connector;
}

export async function updateConnector(
  id: string,
  input: UpdateConnectorInput,
): Promise<IConnector> {
  const connector = await getConnector(id);
  if (connector.builtIn && (input.url !== undefined || input.token)) {
    throw new ConnectorError(
      "The primary connector's URL and credentials come from the environment",
      400,
    );
  }
  if (input.token !== undefined && connector.auth !== "bearer") {
    throw new ConnectorError("Only a bearer connector takes a token", 400);
  }
  if (input.oauthClient !== undefined && connector.auth !== "oauth") {
    throw new ConnectorError("Only an OAuth connector takes a client", 400);
  }
  if (input.name !== undefined) connector.name = input.name;
  if (input.approval !== undefined) connector.approval = input.approval;
  if (input.enabled !== undefined) connector.enabled = input.enabled;
  if (input.disabledTools !== undefined) {
    connector.disabledTools = [...new Set(input.disabledTools)];
  }
  const endpointChanged =
    input.url !== undefined && input.url !== connector.url;
  if (input.url !== undefined) connector.url = input.url;
  if (input.token !== undefined) connector.secret = encryptSecret(input.token);
  if (endpointChanged && connector.auth === "oauth") {
    connector.oauth = {};
    connector.status = "needs-auth";
    connector.statusDetail = "The URL changed; authorize again";
  }
  if (
    input.oauthClient !== undefined &&
    oauthClientChanged(connector.oauthClient, input.oauthClient)
  ) {
    connector.oauthClient = input.oauthClient
      ? storedOAuthClient(input.oauthClient, connector.oauthClient)
      : undefined;
    connector.oauth = {};
    connector.status = "needs-auth";
    connector.statusDetail = "The OAuth client changed; authorize again";
  }
  await connector.save();
  if (
    (endpointChanged && connector.auth !== "oauth") ||
    input.token !== undefined
  ) {
    return refreshConnectorTools(connector);
  }
  return connector;
}

export async function deleteConnector(id: string): Promise<void> {
  const connector = await getConnector(id);
  if (connector.builtIn) {
    throw new ConnectorError("The primary connector cannot be deleted", 400);
  }
  await Connector.deleteOne({ _id: connector._id });
}

type ConnectorTransport = Extract<
  Parameters<typeof createMCPClient>[0]["transport"],
  { type: "sse" | "http" }
>;

/**
 * Names the agent session on every request. An MCP session lives one turn —
 * the client is closed with the turn — so a server that keeps state across
 * turns (the browser keeps a conversation's tabs) keys it on this instead.
 * `apps/browser/src/mcp-sessions.ts` reads the same name.
 */
export const AGENT_SESSION_HEADER = "x-agent-session";

/** The id itself never leaves the box; a server only needs it to be stable. */
export function agentSessionKey(session: string): string {
  return createHash("sha256").update(session).digest("hex").slice(0, 32);
}

export interface ConnectorClientOptions {
  /** A conversation or run id; hashed before it is sent. */
  session?: string;
}

function connectorTransport(
  connector: IConnector,
  options: ConnectorClientOptions,
): ConnectorTransport {
  const headers: Record<string, string> = options.session
    ? { [AGENT_SESSION_HEADER]: agentSessionKey(options.session) }
    : {};
  switch (connector.auth) {
    case "service":
      return {
        type: "http",
        url: connector.url,
        headers,
        fetch: primaryConnectorFetch(),
      };
    case "none":
      return { type: "http", url: connector.url, headers };
    case "bearer":
      if (!connector.secret) {
        throw new ConnectorError("This connector has no token", 400);
      }
      return {
        type: "http",
        url: connector.url,
        headers: {
          ...headers,
          authorization: `Bearer ${decryptSecret(connector.secret)}`,
        },
      };
    case "oauth":
      return {
        type: "http",
        url: connector.url,
        headers,
        authProvider: new ConnectorOAuthProvider(connector),
      };
  }
}

/**
 * One MCP client for one connector. The caller owns closing it. `redirect`
 * stays at the SDK's `'error'` default: a server outside our control must not
 * bounce the request, bearer token and all, to another host.
 */
export async function openConnectorClient(
  connector: IConnector,
  options: ConnectorClientOptions = {},
): Promise<MCPClient> {
  return createMCPClient({
    transport: connectorTransport(connector, options),
    clientName: "denizlg24-agent",
    initializationOptions: {
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    },
  });
}

function errorStatus(error: unknown): {
  status: IConnector["status"];
  detail: string;
} {
  if (error instanceof PrimaryConnectorUnavailableError) {
    return { status: "unconfigured", detail: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof Error &&
    (error.name === "UnauthorizedError" ||
      /\b401\b|unauthori[sz]ed/i.test(message))
  ) {
    return { status: "needs-auth", detail: message.slice(0, 500) };
  }
  return { status: "error", detail: message.slice(0, 500) };
}

/**
 * The SDK's own message ("does not support dynamic client registration", a
 * token endpoint's error) is the only useful diagnosis, and anything but a
 * ConnectorError reaches the owner as a bare 500.
 */
function authorizationError(error: unknown): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ConnectorError(message.slice(0, 300), 502);
}

/**
 * Re-lists a connector's tools and records the outcome. A failure never
 * throws: it is written to the row as the status the UI shows.
 */
export async function refreshConnectorTools(
  connector: IConnector,
): Promise<IConnector> {
  let client: MCPClient | null = null;
  try {
    client = await openConnectorClient(connector);
    const definitions: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const listed = await client.listTools({
        ...(cursor ? { params: { cursor } } : {}),
        options: { signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) },
      });
      definitions.push(...listed.tools);
      cursor = listed.nextCursor;
      if (!cursor) break;
    }
    connector.toolCache = {
      definitions,
      ...(client.instructions ? { instructions: client.instructions } : {}),
      fetchedAt: new Date(),
    };
    connector.status = "ready";
    connector.statusDetail = undefined;
  } catch (error) {
    const { status, detail } = errorStatus(error);
    connector.status = status;
    connector.statusDetail = detail;
  } finally {
    await client?.close().catch(() => {});
  }
  connector.lastCheckedAt = new Date();
  await connector.save();
  return connector;
}

export async function startConnectorAuthorization(
  id: string,
): Promise<ConnectorAuthorizeResponse> {
  const connector = await getConnector(id);
  if (connector.auth !== "oauth") {
    throw new ConnectorError("This connector does not use OAuth", 400);
  }
  const provider = new ConnectorOAuthProvider(connector);
  const result = await auth(provider, {
    serverUrl: connector.url,
    scope: provider.scope,
  }).catch((error: unknown) => {
    throw authorizationError(error);
  });
  if (result === "AUTHORIZED") {
    await refreshConnectorTools(await getConnector(id));
    return { status: "authorized" };
  }
  if (!provider.authorizationUrl) {
    throw new ConnectorError("The server returned no authorization URL", 502);
  }
  return {
    status: "redirect",
    authorizationUrl: provider.authorizationUrl.toString(),
  };
}

/**
 * Finishes an authorization from the browser callback. The connector is found
 * by the hash of `state` and only while it is unexpired, which is what makes
 * this safe to serve without a session.
 */
export async function completeConnectorAuthorization(params: {
  state: string;
  code: string;
  issuer?: string;
}): Promise<IConnector> {
  await connectDB();
  const connector = await Connector.findOne({
    "oauth.stateHash": hashOAuthState(params.state),
    "oauth.stateExpiresAt": { $gt: new Date() },
  });
  if (!connector) {
    throw new ConnectorError("This authorization link has expired", 400);
  }
  const provider = new ConnectorOAuthProvider(connector, params.state);
  try {
    await auth(provider, {
      serverUrl: connector.url,
      authorizationCode: params.code,
      callbackState: params.state,
      scope: provider.scope,
      ...(params.issuer ? { callbackIssuer: params.issuer } : {}),
    });
  } catch (error) {
    throw authorizationError(error);
  } finally {
    await Connector.updateOne(
      { _id: connector._id },
      { $unset: { "oauth.stateHash": 1, "oauth.stateExpiresAt": 1 } },
    );
  }
  return refreshConnectorTools(await getConnector(connector._id.toString()));
}

export async function disconnectConnectorAuthorization(
  id: string,
): Promise<IConnector> {
  const connector = await getConnector(id);
  if (connector.auth !== "oauth") {
    throw new ConnectorError("This connector does not use OAuth", 400);
  }
  connector.oauth = {};
  connector.status = "needs-auth";
  connector.statusDetail = "Disconnected";
  await connector.save();
  return connector;
}
