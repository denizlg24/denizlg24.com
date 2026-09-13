import { z } from "zod";

/**
 * `_meta` key on an MCP action tool (one tool, `action` enum) carrying each
 * action's flags. Tool-level annotations cannot describe a tool that both
 * lists and deletes, so an approval policy reads this instead.
 */
export const MCP_ACTIONS_META_KEY = "com.denizlg24/actions";

export const mcpActionFlagsSchema = z.object({
  readOnly: z.boolean(),
  destructive: z.boolean(),
});
export type McpActionFlags = z.infer<typeof mcpActionFlagsSchema>;

export const mcpActionsMetaSchema = z.record(z.string(), mcpActionFlagsSchema);
export type McpActionsMeta = z.infer<typeof mcpActionsMetaSchema>;

/** The seeded connector for this infrastructure's own MCP server. */
export const PRIMARY_CONNECTOR_SLUG = "denizlg24";

export const connectorSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, "Lowercase letters, digits and dashes");

/**
 * - `service`: the primary connector, authenticated with this site's own
 *   client_credentials grant — never configurable, never exposed.
 * - `none`: an open server.
 * - `bearer`: a static token sent as `Authorization: Bearer`.
 * - `oauth`: MCP authorization (discovery, dynamic registration, PKCE).
 */
export const connectorAuthSchema = z.enum([
  "service",
  "none",
  "bearer",
  "oauth",
]);
export type ConnectorAuth = z.infer<typeof connectorAuthSchema>;

/**
 * - `reads-auto`: read-only tools run, everything else asks.
 * - `always-ask`: every call asks.
 * - `never-ask`: every call runs.
 */
export const connectorApprovalSchema = z.enum([
  "reads-auto",
  "always-ask",
  "never-ask",
]);
export type ConnectorApproval = z.infer<typeof connectorApprovalSchema>;

export const connectorStatusSchema = z.enum([
  "ready",
  "needs-auth",
  "error",
  "unconfigured",
]);
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>;

export const connectorToolSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  readOnly: z.boolean(),
  destructive: z.boolean(),
  /** Per-action flags when the tool is an action tool. */
  actions: mcpActionsMetaSchema.optional(),
});
export type ConnectorTool = z.infer<typeof connectorToolSchema>;

export const connectorSchema = z.object({
  id: z.string(),
  slug: connectorSlugSchema,
  name: z.string(),
  url: z.url(),
  auth: connectorAuthSchema,
  approval: connectorApprovalSchema,
  enabled: z.boolean(),
  disabledTools: z.array(z.string()),
  status: connectorStatusSchema,
  statusDetail: z.string().nullable(),
  toolCount: z.number().int().nonnegative(),
  /** True for the seeded primary connector: no delete, no auth change. */
  builtIn: z.boolean(),
  hasSecret: z.boolean(),
  lastCheckedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Connector = z.infer<typeof connectorSchema>;

export const connectorListSchema = z.object({
  connectors: z.array(connectorSchema),
});
export type ConnectorList = z.infer<typeof connectorListSchema>;

export const connectorDetailSchema = z.object({
  connector: connectorSchema,
  tools: z.array(connectorToolSchema),
});
export type ConnectorDetail = z.infer<typeof connectorDetailSchema>;

const connectorNameSchema = z.string().trim().min(1).max(60);

export const createConnectorInputSchema = z.discriminatedUnion("auth", [
  z.object({
    auth: z.literal("none"),
    slug: connectorSlugSchema,
    name: connectorNameSchema,
    url: z.url(),
    approval: connectorApprovalSchema.default("reads-auto"),
  }),
  z.object({
    auth: z.literal("bearer"),
    slug: connectorSlugSchema,
    name: connectorNameSchema,
    url: z.url(),
    approval: connectorApprovalSchema.default("reads-auto"),
    token: z.string().min(1).max(4_096),
  }),
  z.object({
    auth: z.literal("oauth"),
    slug: connectorSlugSchema,
    name: connectorNameSchema,
    url: z.url(),
    approval: connectorApprovalSchema.default("reads-auto"),
  }),
]);
export type CreateConnectorInput = z.infer<typeof createConnectorInputSchema>;

export const updateConnectorInputSchema = z
  .object({
    name: connectorNameSchema,
    url: z.url(),
    approval: connectorApprovalSchema,
    enabled: z.boolean(),
    disabledTools: z.array(z.string().max(200)).max(1_000),
    /** Replaces the bearer token; only valid on a `bearer` connector. */
    token: z.string().min(1).max(4_096),
  })
  .partial();
export type UpdateConnectorInput = z.infer<typeof updateConnectorInputSchema>;

export const connectorAuthorizeResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("authorized") }),
  z.object({ status: z.literal("redirect"), authorizationUrl: z.url() }),
]);
export type ConnectorAuthorizeResponse = z.infer<
  typeof connectorAuthorizeResponseSchema
>;
