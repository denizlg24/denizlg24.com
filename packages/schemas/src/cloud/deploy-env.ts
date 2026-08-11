import { z } from "zod";

import {
  deployEnvScopeSchema,
  deployEnvSourceSchema,
  deploymentKindSchema,
} from "./deploy";
import type { ResourceKind } from "./resources";

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
  /**
   * The search key used to live on the `projects` row, where no deployment
   * could reference it — an app that wanted to query its own index had to be
   * handed the key by hand.
   */
  "search.meilisearch": ["url", "host", "port", "key"],
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
  "search.meilisearch.key",
  "s3.secretAccessKey",
]);

/**
 * Which resource kind backs each namespace. `deployment` and `project` are
 * absent because nothing is provisioned for them — they are facts about the
 * build, always injected, and a project's storage tab must not claim a
 * connection produced them.
 */
export const BINDING_NAMESPACE_RESOURCE_KIND: Partial<
  Record<DeployBindingNamespace, ResourceKind>
> = {
  "database.mongodb": "mongodb",
  "database.postgres": "postgres",
  "database.redis": "redis",
  s3: "s3",
  "search.meilisearch": "meilisearch",
};

/**
 * The resource kind a reference resolves through, or null when the reference is
 * satisfied without one.
 */
export function bindingReferenceResourceKind(
  value: string,
): ResourceKind | null {
  const parsed = parseBindingReference(value);
  if (!parsed) return null;
  return BINDING_NAMESPACE_RESOURCE_KIND[parsed.namespace] ?? null;
}

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

/**
 * `scope` is the only axis a var has. There is deliberately no build/run split:
 * a var that reaches the container but not the build is the single most common
 * way for a framework that inlines env at build time to ship a fallback value
 * with no error anywhere, and the split cost more debugging than it ever saved.
 * The consequence is that a value is visible in the image's layer history, so
 * treat a built image as carrying its secrets.
 */
const envVarBaseSchema = z.object({
  key: deployEnvKeySchema,
  scope: deployEnvScopeSchema.default("all"),
});

/**
 * Mirrors the `deploy_env_vars_source_shape` check constraint. Validating the
 * same rule twice is deliberate: the constraint is the guarantee, and this is
 * the error message.
 */
export const deployEnvVarInputSchema = z.discriminatedUnion("source", [
  envVarBaseSchema.extend({
    source: z.literal("literal"),
    /**
     * Absent means "keep what is stored". `GET .../env` never returns a
     * literal's value, so a full replace that demanded one would force the
     * editor to re-type every secret on the target to change a scope.
     */
    value: z.string().max(32_768).optional(),
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
  /**
   * One map, used for both the build and the container. The agent adds its own
   * run-time facts (`PORT`, `NODE_ENV`) on the run side only — `NODE_ENV` in
   * particular must not reach a build, where it makes an install skip
   * devDependencies and fail on a missing compiler.
   */
  env: z.record(z.string(), z.string()),
});
export type AgentDeploymentEnv = z.infer<typeof agentDeploymentEnvSchema>;
