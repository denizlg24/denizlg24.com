import { z } from "zod";

import {
  deployEnvScopeSchema,
  deployEnvSourceSchema,
  deploymentKindSchema,
} from "./deploy";

/**
 * The whole vocabulary a binding may resolve to. It is closed on purpose: a
 * reference that is merely a string invites `database.postgres.urL` and a
 * deployment that builds for three minutes before failing on an env var nobody
 * set. Everything downstream — the resolver, the pre-flight check and the
 * bindings picker in the UI — reads this one object.
 */
export const DEPLOY_BINDING_NAMESPACES = {
  "database.postgres": ["url", "host", "port", "user", "password", "database"],
  "database.mongodb": ["url", "host", "port", "user", "password", "database"],
  "database.redis": ["url", "host", "port", "user", "password"],
  s3: ["endpoint", "region", "bucket", "accessKeyId", "secretAccessKey"],
  deployment: ["id", "sha", "ref", "hostname", "url", "kind"],
  project: ["slug", "name"],
} as const satisfies Record<string, readonly string[]>;

export type DeployBindingNamespace = keyof typeof DEPLOY_BINDING_NAMESPACES;

export const DEPLOY_BINDING_NAMESPACE_NAMES = Object.keys(
  DEPLOY_BINDING_NAMESPACES,
) as DeployBindingNamespace[];

export const DEPLOY_BINDING_REFERENCES: readonly string[] =
  DEPLOY_BINDING_NAMESPACE_NAMES.flatMap((namespace) =>
    DEPLOY_BINDING_NAMESPACES[namespace].map(
      (field) => `${namespace}.${field}`,
    ),
  );

const REFERENCE_SET: ReadonlySet<string> = new Set(DEPLOY_BINDING_REFERENCES);

/**
 * References whose value is a credential. `url` is in here because every
 * connection string carries the password inline — redacting `password` while
 * printing `url` next to it protects nothing.
 */
export const SECRET_DEPLOY_BINDING_REFERENCES: ReadonlySet<string> = new Set([
  "database.postgres.url",
  "database.postgres.password",
  "database.mongodb.url",
  "database.mongodb.password",
  "database.redis.url",
  "database.redis.password",
  "s3.secretAccessKey",
]);

export function isDeployBindingReference(value: string): boolean {
  return REFERENCE_SET.has(value);
}

export function isSecretDeployBindingReference(value: string): boolean {
  return SECRET_DEPLOY_BINDING_REFERENCES.has(value);
}

export interface ParsedBindingReference {
  namespace: DeployBindingNamespace;
  field: string;
}

export function parseBindingReference(
  value: string,
): ParsedBindingReference | null {
  if (!REFERENCE_SET.has(value)) return null;
  const separator = value.lastIndexOf(".");
  const namespace = value.slice(0, separator) as DeployBindingNamespace;
  return { namespace, field: value.slice(separator + 1) };
}

export const deployBindingReferenceSchema = z
  .string()
  .max(255)
  .refine(isDeployBindingReference, "Unknown binding reference");

/**
 * `${namespace.field}` and nothing else. Anything resembling an expression is
 * left alone rather than half-evaluated: the goal is reshaping a connection
 * string, and a template language here is a liability that has to be secured.
 */
const TEMPLATE_PATTERN = /\$\{([a-zA-Z0-9_.]+)\}/g;

export function extractTemplateReferences(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TEMPLATE_PATTERN)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export function renderTemplate(
  template: string,
  values: ReadonlyMap<string, string>,
): string {
  return template.replace(TEMPLATE_PATTERN, (whole, reference: string) =>
    values.has(reference) ? (values.get(reference) as string) : whole,
  );
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const deployEnvKeySchema = z
  .string()
  .min(1)
  .max(255)
  .regex(ENV_KEY_PATTERN, "Not a valid environment variable name");

const envVarBaseSchema = z.object({
  key: deployEnvKeySchema,
  scope: deployEnvScopeSchema.default("all"),
  buildTime: z.boolean().default(false),
  runTime: z.boolean().default(true),
});

/**
 * Mirrors the `deploy_env_vars_source_shape` check constraint. Validating the
 * same rule twice is deliberate: the constraint is the guarantee, and this is
 * the error message.
 */
export const deployEnvVarInputSchema = z.discriminatedUnion("source", [
  envVarBaseSchema.extend({
    source: z.literal("literal"),
    value: z.string().max(32_768),
  }),
  envVarBaseSchema.extend({
    source: z.literal("binding"),
    reference: deployBindingReferenceSchema,
  }),
  envVarBaseSchema.extend({
    source: z.literal("template"),
    template: z.string().min(1).max(32_768),
  }),
]);
export type DeployEnvVarInput = z.infer<typeof deployEnvVarInputSchema>;

export const replaceDeployEnvInputSchema = z.object({
  vars: z.array(deployEnvVarInputSchema).max(500),
});
export type ReplaceDeployEnvInput = z.infer<typeof replaceDeployEnvInputSchema>;

/**
 * What the browser is allowed to read back. A literal's value never appears —
 * only that one is set, so the editor can show a placeholder without the round
 * trip becoming a way to exfiltrate every secret on the target.
 */
export const deployEnvVarSchema = z.object({
  id: z.uuid(),
  key: deployEnvKeySchema,
  source: deployEnvSourceSchema,
  reference: z.string().nullable(),
  template: z.string().nullable(),
  hasValue: z.boolean(),
  scope: deployEnvScopeSchema,
  buildTime: z.boolean(),
  runTime: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type DeployEnvVar = z.infer<typeof deployEnvVarSchema>;

/**
 * Unavailable references are listed rather than hidden. The picker showing
 * `database.postgres.url` greyed out answers "why can I not bind this?" with
 * "the project has no Postgres", which is the actual next action.
 */
export const deployBindingValueSchema = z.object({
  reference: z.string(),
  available: z.boolean(),
  secret: z.boolean(),
});
export type DeployBindingValue = z.infer<typeof deployBindingValueSchema>;

export const deployBindingsSchema = z.object({
  targetId: z.uuid(),
  bindings: z.array(deployBindingValueSchema),
});
export type DeployBindings = z.infer<typeof deployBindingsSchema>;

/**
 * The response to the one route that returns plaintext env. It carries the
 * clone token too: both are short-lived, both are fetched once by the agent
 * immediately before use, and keeping them on one request means there is a
 * single place to audit rather than two.
 */
export const agentDeploymentEnvSchema = z.object({
  deploymentId: z.uuid(),
  kind: deploymentKindSchema,
  cloneToken: z.string().nullable(),
  buildEnv: z.record(z.string(), z.string()),
  runEnv: z.record(z.string(), z.string()),
});
export type AgentDeploymentEnv = z.infer<typeof agentDeploymentEnvSchema>;
