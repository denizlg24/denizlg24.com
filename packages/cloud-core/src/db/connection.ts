import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type RawSqlClient = ReturnType<typeof postgres>;

export interface PostgresClientOptions {
  max?: number;
  idleTimeoutSeconds?: number;
}

const DEFAULT_APP_POOL_MAX = 5;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 20;

function postgresOptions(options?: PostgresClientOptions) {
  return {
    max: options?.max ?? DEFAULT_APP_POOL_MAX,
    idle_timeout: options?.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECONDS,
  };
}

export function createDb(
  connectionString: string,
  options?: PostgresClientOptions,
) {
  const client = postgres(connectionString, postgresOptions(options));
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

export function createRawClient(
  connectionString: string,
  options?: PostgresClientOptions,
): RawSqlClient {
  return postgres(
    connectionString,
    postgresOptions({
      ...options,
      max: options?.max ?? 1,
    }),
  );
}
