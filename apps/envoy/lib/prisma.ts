import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { getEnv } from "./env";

const globalForPrisma = globalThis as unknown as {
  envoyPrisma?: PrismaClient;
};

export function getPrisma(): PrismaClient {
  if (globalForPrisma.envoyPrisma) return globalForPrisma.envoyPrisma;

  const adapter = new PrismaPg({
    connectionString: getEnv().ENVOY_DATABASE_URL,
  });
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.envoyPrisma = client;
  }
  return client;
}

// API modules can retain normal `prisma.model` call sites while client
// construction stays request-lazy. This keeps public-page builds independent
// from production credentials and still fails fast on the first database use.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
