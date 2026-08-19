import "dotenv/config"
import { drizzle } from "drizzle-orm/node-postgres"

import { schema } from "@/db/schema"

const databaseUrl = process.env.DATABASE_URL
const ssl =
  databaseUrl?.includes("sslmode=require") || databaseUrl?.includes("ssl=true")
    ? true
    : undefined

export const db = drizzle({
  connection: {
    connectionString: databaseUrl!,
    ssl,
  },
  schema,
})
