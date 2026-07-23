import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type RawSqlClient = ReturnType<typeof postgres>;

export interface PostgresClientOptions {
  max?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}

const DEFAULT_APP_POOL_MAX = 5;
const DEFAULT_IDLE_TIMEOUT_SECONDS = 20;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;

function positiveTimeoutSeconds(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be greater than zero`);
  }
  return value;
}

function connectTimeoutSeconds(options?: PostgresClientOptions): number {
  if (options?.connectTimeoutSeconds !== undefined) {
    return positiveTimeoutSeconds(
      options.connectTimeoutSeconds,
      "connectTimeoutSeconds",
    );
  }

  const configuredTimeout = process.env.PGCONNECT_TIMEOUT;
  if (configuredTimeout === undefined) {
    return DEFAULT_CONNECT_TIMEOUT_SECONDS;
  }

  return positiveTimeoutSeconds(Number(configuredTimeout), "PGCONNECT_TIMEOUT");
}

function postgresOptions(options?: PostgresClientOptions) {
  return {
    connect_timeout: connectTimeoutSeconds(options),
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
