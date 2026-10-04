import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "../config/env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
