import {
  authAccount,
  authUser,
  CREDENTIAL_ACCOUNT_ISSUER,
  createDb,
  hashPassword,
  users,
} from "@repo/cloud-core";
import { eq } from "drizzle-orm";

const databaseUrl = process.env.OPS_E2E_DATABASE_URL;
const password = process.env.OPS_E2E_PASSWORD;
const action = process.argv[2];
const userId = "00000000-0000-4000-8000-000000000006";

if (!databaseUrl || (action !== "cleanup" && !password)) {
  throw new Error(
    "OPS_E2E_DATABASE_URL is required, along with OPS_E2E_PASSWORD for setup and activation",
  );
}
const parsedUrl = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost"].includes(parsedUrl.hostname) ||
  parsedUrl.port !== "5433"
) {
  throw new Error("The ops e2e user script only runs against localhost:5433");
}

const db = createDb(databaseUrl, { max: 1 });
try {
  if (action === "cleanup") {
    await db.delete(authUser).where(eq(authUser.id, userId));
    await db.delete(users).where(eq(users.id, userId));
  } else if (action === "activate") {
    await db
      .update(authUser)
      .set({ twoFactorEnabled: true })
      .where(eq(authUser.id, userId));
  } else if (action === "setup") {
    const now = new Date();
    const passwordHash = await hashPassword(password!);
    await db.delete(authUser).where(eq(authUser.id, userId));
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(authUser).values({
      id: userId,
      name: "ops-e2e",
      email: "ops-e2e@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      realm: "cloud",
      role: "admin",
      status: "active",
      twoFactorEnabled: false,
      username: "ops-e2e",
      displayUsername: "ops-e2e",
    });
    await db.insert(authAccount).values({
      id: `credential:${userId}`,
      accountId: userId,
      issuer: CREDENTIAL_ACCOUNT_ISSUER,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userId,
      username: "ops-e2e",
      email: "ops-e2e@example.test",
      passwordHash,
      role: "superuser",
      status: "active",
      totpEnabled: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    throw new Error("Expected setup, activate, or cleanup");
  }
} finally {
  await db.$client.end();
}
