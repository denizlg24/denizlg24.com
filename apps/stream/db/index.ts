import { drizzle } from "drizzle-orm/node-postgres";

import { schema } from "./schema";

const databaseUrl = process.env.STREAM_DATABASE_URL;
const ssl =
  databaseUrl?.includes("sslmode=require") || databaseUrl?.includes("ssl=true")
    ? true
    : undefined;

export const db = drizzle({
  connection: {
    connectionString: databaseUrl ?? "",
    max: Number(process.env.DB_POOL_MAX ?? 5),
    ssl,
  },
  schema,
});

export type Database = typeof db;
