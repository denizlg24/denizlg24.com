import { createRawClient } from "../db";
import type { ProjectCollection } from "../db/schema";
import type { PgClientFactory } from "../sync";

export interface ProjectPgClientFactory extends PgClientFactory {
  forDatabase(database: string): Promise<{
    sql: import("postgres").Sql;
    close: () => Promise<void>;
  }>;
}

export function createProjectPgClientFactory(
  databaseUrl: string,
): ProjectPgClientFactory {
  const forDatabase = async (database: string) => {
    const url = new URL(databaseUrl);
    url.pathname = `/${encodeURIComponent(database)}`;
    const sql = createRawClient(url.toString(), { max: 1 });
    return {
      sql,
      close: async () => {
        await sql.end();
      },
    };
  };
  return {
    forDatabase,
    async forCollection(collection: ProjectCollection) {
      if (!collection.pgDatabase) {
        throw new Error(`Collection ${collection.id} missing pgDatabase`);
      }
      return forDatabase(collection.pgDatabase);
    },
  };
}
