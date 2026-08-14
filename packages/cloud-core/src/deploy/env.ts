import {
  DEPLOY_BINDING_NAMESPACE_NAMES,
  DEPLOY_BINDING_NAMESPACES,
  type DeployBindingNamespace,
  type DeployBindingValue,
  type DeploymentKind,
  extractTemplateReferences,
  isDeployBindingReference,
  isSecretDeployBindingReference,
  parseBindingReference,
  renderTemplate,
} from "@repo/schemas/cloud";

import type { DeployEnvVarRow } from "../db/schema";
import { ValidationError } from "../errors";

export type NamespaceValues = Readonly<Record<string, string>>;

/**
 * `null` means the project has not provisioned this namespace. It is not the
 * same as an empty object, which would resolve every field to undefined and
 * hand the container a blank `DATABASE_URL` instead of failing.
 */
export type NamespaceResolver = () => Promise<NamespaceValues | null>;

export interface DeploymentIdentity {
  id: string;
  sha: string;
  ref: string;
  hostname: string;
  kind: DeploymentKind;
  /** Set exactly when `kind` is `environment`. */
  environmentId?: string | null;
  /**
   * What `deployment.environment` resolves to: the environment's name, or
   * `production` / `preview`. The enum is already available as
   * `deployment.kind`; this is the label an app would branch on.
   */
  environmentName?: string | null;
}

export interface ProjectIdentity {
  slug: string;
  name: string;
}

/**
 * Only the namespaces a deployment actually references are ever asked for.
 * This is the point of the design, not an optimisation: `s3` issues a real,
 * revocable credential row per deployment, so resolving it for an app that
 * never touches storage produces hundreds of live credentials nobody audits.
 */
export interface DeployBindingResolvers {
  "database.postgres": NamespaceResolver;
  "database.mongodb": NamespaceResolver;
  "database.redis": NamespaceResolver;
  "search.meilisearch": NamespaceResolver;
  s3: NamespaceResolver;
}

export class BindingUnresolvableError extends ValidationError {
  readonly keys: readonly string[];
  readonly references: readonly string[];

  constructor(references: readonly string[], keys: readonly string[]) {
    super(
      `Unresolvable binding${references.length === 1 ? "" : "s"}: ${references.join(", ")}`,
      "BINDING_UNRESOLVABLE",
    );
    this.references = references;
    this.keys = keys;
  }
}

/** Every reference a row spends, whether by binding or by interpolation. */
export function referencesForRow(row: DeployEnvVarRow): string[] {
  if (row.source === "binding") return row.reference ? [row.reference] : [];
  if (row.source === "template")
    return row.template ? extractTemplateReferences(row.template) : [];
  return [];
}

export function collectReferences(
  rows: readonly DeployEnvVarRow[],
): Map<string, string[]> {
  const byReference = new Map<string, string[]>();
  for (const row of rows) {
    for (const reference of referencesForRow(row)) {
      const keys = byReference.get(reference);
      if (keys) keys.push(row.key);
      else byReference.set(reference, [row.key]);
    }
  }
  return byReference;
}

export function namespacesForReferences(
  references: Iterable<string>,
): Set<DeployBindingNamespace> {
  const namespaces = new Set<DeployBindingNamespace>();
  for (const reference of references) {
    const parsed = parseBindingReference(reference);
    if (parsed) namespaces.add(parsed.namespace);
  }
  return namespaces;
}

/**
 * Which platform-owned namespaces this project can actually satisfy. Only the
 * connected resources vary: `s3` can always be issued, and `deployment` and
 * `project` are properties of the run itself.
 */
export interface DeployNamespaceAvailability {
  postgres: boolean;
  mongodb: boolean;
  redis: boolean;
  meilisearch: boolean;
}

export interface DefaultDeployEnvBinding {
  key: string;
  reference: string;
}

/**
 * Conventional database bindings for a newly created target.
 *
 * S3 stays opt-in even when project storage exists: referencing `s3.*` mints a
 * real per-deployment credential, so silently adding those rows would silently
 * grant every service storage access.
 */
export function defaultDeployEnvBindings(
  availability: DeployNamespaceAvailability,
): DefaultDeployEnvBinding[] {
  const bindings: DefaultDeployEnvBinding[] = [];
  if (availability.postgres) {
    bindings.push({
      key: "DATABASE_URL",
      reference: "database.postgres.url",
    });
  }
  if (availability.mongodb) {
    bindings.push({ key: "MONGODB_URI", reference: "database.mongodb.url" });
  }
  if (availability.redis) {
    bindings.push({ key: "REDIS_URL", reference: "database.redis.url" });
  }
  return bindings;
}

function isAvailable(
  namespace: DeployBindingNamespace,
  availability: DeployNamespaceAvailability,
): boolean {
  if (namespace === "database.postgres") return availability.postgres;
  if (namespace === "database.mongodb") return availability.mongodb;
  if (namespace === "database.redis") return availability.redis;
  if (namespace === "search.meilisearch") return availability.meilisearch;
  return true;
}

/**
 * The pre-flight check. It runs at enqueue time and never resolves a value,
 * because the whole point is finding out before waiting three minutes for a
 * build that was always going to fail on a missing env var.
 */
export function assertBindingsResolvable(
  rows: readonly DeployEnvVarRow[],
  availability: DeployNamespaceAvailability,
): void {
  const byReference = collectReferences(rows);
  const unresolvable: string[] = [];
  const keys = new Set<string>();
  for (const [reference, referencingKeys] of byReference) {
    const parsed = isDeployBindingReference(reference)
      ? parseBindingReference(reference)
      : null;
    if (parsed && isAvailable(parsed.namespace, availability)) continue;
    unresolvable.push(reference);
    for (const key of referencingKeys) keys.add(key);
  }
  if (unresolvable.length > 0) {
    throw new BindingUnresolvableError(unresolvable.sort(), [...keys].sort());
  }
}

export interface ResolveDeploymentEnvOptions {
  rows: readonly DeployEnvVarRow[];
  deployment: DeploymentIdentity;
  project: ProjectIdentity;
  resolvers: DeployBindingResolvers;
  /** Decrypts a `literal` row. Kept out of here so the key never has to be. */
  decrypt: (row: DeployEnvVarRow) => string;
  /**
   * Decrypted Envoy env, if the target is linked to an Envoy project. Applied
   * under the target's own rows, so an explicit row always wins.
   */
  envoy?: Readonly<Record<string, string>>;
}

export interface ResolvedDeploymentEnv {
  /**
   * One map for the build and the container alike. The platform injects
   * nothing implicit here: `PORT` and `NODE_ENV` are run-time facts the agent
   * adds when it starts the container, because `NODE_ENV=production` during a
   * build makes an install step skip devDependencies and the build then fails
   * on a missing compiler — a failure that reads as a broken repository rather
   * than as an env var the platform set behind your back.
   */
  env: Record<string, string>;
  /** Keys only. A resolved map is never logged; the key list is the audit. */
  keys: string[];
}

/**
 * `environment` does not mean "any environment" — it names one. A staging
 * deployment picks up `all` and the rows scoped to staging, and nothing else.
 * Inheriting production's rows would hand staging production's database
 * credentials, which is the exact failure separate environments exist to
 * prevent; that is why this is an equality on the id and not on the scope.
 */
export function envVarAppliesTo(
  row: Pick<DeployEnvVarRow, "scope" | "environmentId">,
  deployment: Pick<DeploymentIdentity, "kind" | "environmentId">,
): boolean {
  if (row.scope === "all") return true;
  if (row.scope !== deployment.kind) return false;
  if (row.scope !== "environment") return true;
  return (
    row.environmentId !== null &&
    row.environmentId === (deployment.environmentId ?? null)
  );
}

export function deploymentNamespaceValues(
  deployment: DeploymentIdentity,
): NamespaceValues {
  return {
    id: deployment.id,
    sha: deployment.sha,
    ref: deployment.ref,
    hostname: deployment.hostname,
    url: `https://${deployment.hostname}`,
    kind: deployment.kind,
    environment: deployment.environmentName ?? deployment.kind,
  };
}

async function resolveNamespaces(
  needed: ReadonlySet<DeployBindingNamespace>,
  options: ResolveDeploymentEnvOptions,
): Promise<Map<DeployBindingNamespace, NamespaceValues | null>> {
  const resolved = new Map<DeployBindingNamespace, NamespaceValues | null>();
  for (const namespace of needed) {
    if (namespace === "deployment") {
      resolved.set(namespace, deploymentNamespaceValues(options.deployment));
      continue;
    }
    if (namespace === "project") {
      resolved.set(namespace, {
        slug: options.project.slug,
        name: options.project.name,
      });
      continue;
    }
    resolved.set(namespace, await options.resolvers[namespace]());
  }
  return resolved;
}

export async function resolveDeploymentEnv(
  options: ResolveDeploymentEnvOptions,
): Promise<ResolvedDeploymentEnv> {
  const rows = options.rows.filter((row) =>
    envVarAppliesTo(row, options.deployment),
  );
  const byReference = collectReferences(rows);

  const unknown: string[] = [];
  const unknownKeys = new Set<string>();
  for (const [reference, keys] of byReference) {
    if (isDeployBindingReference(reference)) continue;
    unknown.push(reference);
    for (const key of keys) unknownKeys.add(key);
  }
  if (unknown.length > 0) {
    throw new BindingUnresolvableError(unknown.sort(), [...unknownKeys].sort());
  }

  const namespaces = await resolveNamespaces(
    namespacesForReferences(byReference.keys()),
    options,
  );

  const values = new Map<string, string>();
  const missing: string[] = [];
  const missingKeys = new Set<string>();
  for (const [reference, keys] of byReference) {
    const parsed = parseBindingReference(reference);
    // Guaranteed by the unknown-reference pass above.
    if (!parsed) continue;
    const namespaceValues = namespaces.get(parsed.namespace);
    const value = namespaceValues?.[parsed.field];
    if (value === undefined) {
      missing.push(reference);
      for (const key of keys) missingKeys.add(key);
      continue;
    }
    values.set(reference, value);
  }
  if (missing.length > 0) {
    throw new BindingUnresolvableError(missing.sort(), [...missingKeys].sort());
  }

  // Envoy env first so an explicit row on the target always wins.
  const resolved = new Map<string, string>(Object.entries(options.envoy ?? {}));
  for (const row of rows) {
    const value =
      row.source === "literal"
        ? options.decrypt(row)
        : row.source === "binding"
          ? (values.get(row.reference ?? "") ?? "")
          : renderTemplate(row.template ?? "", values);
    resolved.set(row.key, value);
  }

  const env = Object.fromEntries(resolved);
  return { env, keys: Object.keys(env).sort() };
}

/**
 * The bindings picker: every reference in the vocabulary with whether this
 * project can satisfy it. Values never appear — a picker that prints
 * `database.postgres.password` next to a copy button is a credential viewer.
 */
export function describeBindings(
  availability: DeployNamespaceAvailability,
): DeployBindingValue[] {
  return DEPLOY_BINDING_NAMESPACE_NAMES.flatMap((namespace) =>
    DEPLOY_BINDING_NAMESPACES[namespace].map((field) => ({
      reference: `${namespace}.${field}`,
      available: isAvailable(namespace, availability),
      secret: isSecretDeployBindingReference(`${namespace}.${field}`),
    })),
  );
}
