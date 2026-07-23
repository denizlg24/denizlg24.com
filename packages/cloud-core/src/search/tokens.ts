import type { Meilisearch } from "meilisearch";
import { generateTenantToken } from "meilisearch/token";

import { ValidationError } from "../errors";

const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const PROJECT_KEY_ACTIONS = [
  "search",
  "documents.add",
  "documents.get",
  "documents.delete",
  "indexes.create",
  "indexes.get",
  "indexes.update",
  "indexes.delete",
  "settings.get",
  "settings.update",
  "stats.get",
  "tasks.get",
  "tasks.cancel",
  "tasks.delete",
  "version",
] as const;

interface CreateKeyClient {
  createKey(
    input: Parameters<Meilisearch["createKey"]>[0],
  ): Promise<{ key: string; uid: string }>;
}

interface DeleteKeyClient {
  deleteKey(uid: string): Promise<unknown>;
}

export async function createProjectSearchKey(
  client: CreateKeyClient,
  projectName: string,
): Promise<{ key: string; uid: string }> {
  const result = await client.createKey({
    description: `Project API key for: ${projectName}`,
    actions: [...PROJECT_KEY_ACTIONS],
    indexes: [`${projectName}_*`],
    expiresAt: null,
  });

  return {
    key: result.key,
    uid: result.uid,
  };
}

export async function deleteProjectSearchKey(
  client: DeleteKeyClient,
  apiKeyUid: string,
): Promise<void> {
  await client.deleteKey(apiKeyUid);
}

export type TenantSearchRules = Record<string, { filter?: string } | null>;

export function validateSearchRules(
  rules: TenantSearchRules,
  projectName: string,
): string | null {
  const prefix = `${projectName}_`;
  const wildcard = `${projectName}_*`;

  for (const indexPattern of Object.keys(rules)) {
    if (indexPattern !== wildcard && !indexPattern.startsWith(prefix)) {
      return `Index "${indexPattern}" is outside project scope "${prefix}*"`;
    }
  }
  return null;
}

export async function generateProjectToken(config: {
  apiKey: string;
  apiKeyUid: string;
  projectName: string;
  searchRules?: TenantSearchRules;
  expiresAt?: Date;
}): Promise<string> {
  const searchRules = config.searchRules ?? {
    [`${config.projectName}_*`]: null,
  };
  const validationError = validateSearchRules(searchRules, config.projectName);
  if (validationError) {
    throw new ValidationError(validationError, "INVALID_SEARCH_RULES");
  }

  return generateTenantToken({
    apiKey: config.apiKey,
    apiKeyUid: config.apiKeyUid,
    searchRules,
    expiresAt: config.expiresAt ?? new Date(Date.now() + DEFAULT_TOKEN_TTL_MS),
  });
}
