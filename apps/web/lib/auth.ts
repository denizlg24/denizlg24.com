import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { type Db, MongoClient } from "mongodb";

declare global {
  var authMongoCache: { client: MongoClient; db: Db } | undefined;
}

function openMongo() {
  const client = new MongoClient(process.env.MONGODB_URI!, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    maxIdleTimeMS: 60000,
  });

  // A closed topology is terminal: every later operation on this client throws
  // MongoTopologyClosedError, so a warm lambda that lost the database once
  // would never serve auth again. Drop the handle and reopen on next use.
  client.on("topologyClosed", () => {
    if (global.authMongoCache?.client === client) {
      global.authMongoCache = undefined;
    }
  });

  return { client, db: client.db() };
}

function liveMongo() {
  global.authMongoCache ??= openMongo();
  return global.authMongoCache;
}

// better-auth resolves the adapter's handles once at construction, so they have
// to be indirections that follow the reconnect rather than fixed references.
function forwardTo<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const current = resolve();
      const value = Reflect.get(current, property, current);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
}

const client = forwardTo(() => liveMongo().client);
const db = forwardTo(() => liveMongo().db);

export const auth = betterAuth({
  advanced: {
    cookiePrefix: "denizlg24",
    useSecureCookies: !!process.env.VERCEL_URL,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
  database: mongodbAdapter(db, {
    client,
  }),
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "guest",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: false,
  },
  plugins: [admin(), nextCookies()],
});
