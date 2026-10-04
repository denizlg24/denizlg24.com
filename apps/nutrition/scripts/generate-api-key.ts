import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../src/db/schema";
import {
  generateApiKey,
  getApiKeyPrefix,
  hashApiKey,
} from "../src/modules/api-keys/keys";
import { ApiKeysRepository } from "../src/modules/api-keys/repository";

interface GenerateArgs {
  name: string;
}

const parseArgs = (): GenerateArgs => {
  const args = Bun.argv.slice(2);
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);

    const index = args.indexOf(name);
    if (index >= 0) return args[index + 1];

    return undefined;
  };

  const name = getValue("--name")?.trim();

  if (!name) {
    throw new Error("Usage: bun run api-key:generate -- --name <name>");
  }

  return { name };
};

const main = async () => {
  const args = parseArgs();
  const databaseUrl = Bun.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
  });
  const database = drizzle(pool, { schema });
  const repository = new ApiKeysRepository(database);
  const key = generateApiKey();
  const created = await repository.create({
    name: args.name,
    keyPrefix: getApiKeyPrefix(key),
    keyHash: hashApiKey(key),
  });

  await pool.end();

  console.log("API key created. Store this value now; it cannot be recovered.");
  console.log(`id=${created.id}`);
  console.log(`name=${created.name}`);
  console.log(`prefix=${created.keyPrefix}`);
  console.log(`key=${key}`);
};

await main();
