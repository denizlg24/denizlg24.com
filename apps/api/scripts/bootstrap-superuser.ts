import { cloudEnv, createDb, requiredEnv } from "@repo/cloud-core";

import { createCloudAuth } from "../src/auth/better-auth";
import { createPendingAuthUser } from "../src/auth/users";

// Every path that creates a user requires an existing superuser session, so a
// fresh database has no way in. This mints the first one — and only the first
// one — reusing the normal pending-signup flow so the account still has to set
// its own password and enroll TOTP before the API will accept it.

const username = process.argv[2]?.trim();
if (!username) {
  throw new Error("Usage: bun run auth:bootstrap-superuser <username>");
}

const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
try {
  const [legacyUser, authUserRow] = await Promise.all([
    db.query.users.findFirst({ columns: { id: true } }),
    db.query.authUser.findFirst({ columns: { id: true } }),
  ]);
  if (legacyUser || authUserRow) {
    throw new Error(
      "Refusing to bootstrap: users already exist. Invite through the cloud admin instead.",
    );
  }

  // Root BETTER_AUTH_URL belongs to apps/web; the cloud API has its own.
  const baseURL = cloudEnv("BETTER_AUTH_URL");
  const auth = createCloudAuth({
    baseURL,
    cookieDomain: process.env.COOKIE_DOMAIN,
    db,
    secret: requiredEnv("BETTER_AUTH_SECRET"),
  });

  const created = await createPendingAuthUser(db, auth, {
    role: "superuser",
    username,
  });

  console.log(`username:     ${created.user.username}`);
  console.log(`signup token: ${created.signupToken}`);
  console.log("expires:      7 days");
  console.log(
    `\nPOST ${baseURL}/api/auth/complete-signup with {username, email, password, token}, then enroll TOTP.`,
  );
} finally {
  await db.$client.end();
}
