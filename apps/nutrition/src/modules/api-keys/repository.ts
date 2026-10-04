import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../../db/client";
import { apiKeys } from "../../db/schema";

export class ApiKeysRepository {
  constructor(private readonly database: Database) {}

  async create(input: { name: string; keyPrefix: string; keyHash: string }) {
    const [apiKey] = await this.database
      .insert(apiKeys)
      .values(input)
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
      });

    if (!apiKey) {
      throw new Error("Failed to create API key");
    }

    return apiKey;
  }

  async findActiveByHash(keyHash: string) {
    const [apiKey] = await this.database
      .select({
        id: apiKeys.id,
        keyPrefix: apiKeys.keyPrefix,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    return apiKey;
  }

  async markUsed(id: string) {
    await this.database
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, id));
  }
}
