import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

import { createRawClient } from "../db";
import {
  MongoProvisioner,
  PostgresProvisioner,
  type RedisCommander,
  RedisProvisioner,
} from "./provisioning";

const RUN_INFRA = process.env.RUN_CLOUD_INFRA_TESTS === "1";
const describeInfra = RUN_INFRA ? describe : describe.skip;
const POSTGRES_URL =
  process.env.CLOUD_TEST_DATABASE_URL ??
  "postgresql://denizcloud:devpassword@localhost:5433/denizcloud";
const MONGO_URI =
  process.env.CLOUD_TEST_MONGODB_ADMIN_URI ??
  "mongodb://denizcloud:devpassword@localhost:27018/?authSource=admin&directConnection=true";
const REDIS_URL =
  process.env.CLOUD_TEST_REDIS_ADMIN_URL ??
  "redis://default:devpassword@localhost:6380";

type RedisValue = string | number | null | RedisValue[];

class TestRedisClient implements RedisCommander {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);

  constructor(private readonly url: string) {}

  async connect(): Promise<void> {
    const parsed = new URL(this.url);
    const socket = createConnection({
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        socket.off("connect", onConnect);
        reject(error);
      };
      socket.once("connect", onConnect);
      socket.once("error", onError);
    });
    if (parsed.password) {
      await this.sendCommand([
        "AUTH",
        decodeURIComponent(parsed.username || "default"),
        decodeURIComponent(parsed.password),
      ]);
    }
  }

  async sendCommand(args: string[]): Promise<RedisValue> {
    if (!this.socket) await this.connect();
    const socket = this.socket;
    if (!socket) throw new Error("Redis socket is not connected");
    const command = `*${args.length}\r\n${args
      .map((argument) => `$${Buffer.byteLength(argument)}\r\n${argument}\r\n`)
      .join("")}`;
    socket.write(command);
    return this.readValue();
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    await new Promise<void>((resolve) => socket.end(resolve));
  }

  private async readValue(): Promise<RedisValue> {
    while (true) {
      const parsed = this.parseValue(0);
      if (parsed) {
        this.buffer = this.buffer.subarray(parsed.nextOffset);
        return parsed.value;
      }
      const chunk = await new Promise<Buffer>((resolve, reject) => {
        const socket = this.socket;
        if (!socket) {
          reject(new Error("Redis socket is not connected"));
          return;
        }
        const onData = (data: Buffer) => {
          socket.off("error", onError);
          resolve(data);
        };
        const onError = (error: Error) => {
          socket.off("data", onData);
          reject(error);
        };
        socket.once("data", onData);
        socket.once("error", onError);
      });
      this.buffer = Buffer.concat([this.buffer, chunk]);
    }
  }

  private parseValue(
    offset: number,
  ): { value: RedisValue; nextOffset: number } | null {
    if (offset >= this.buffer.length) return null;
    const prefix = this.buffer.toString("utf8", offset, offset + 1);
    const lineEnd = this.buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) return null;
    const line = this.buffer.toString("utf8", offset + 1, lineEnd);
    const next = lineEnd + 2;
    if (prefix === "+") return { value: line, nextOffset: next };
    if (prefix === ":") return { value: Number(line), nextOffset: next };
    if (prefix === "-") throw new Error(`Redis error: ${line}`);
    if (prefix === "$") {
      const length = Number(line);
      if (length === -1) return { value: null, nextOffset: next };
      const end = next + length;
      if (this.buffer.length < end + 2) return null;
      return {
        value: this.buffer.toString("utf8", next, end),
        nextOffset: end + 2,
      };
    }
    if (prefix === "*") {
      const count = Number(line);
      if (count === -1) return { value: null, nextOffset: next };
      const values: RedisValue[] = [];
      let current = next;
      for (let index = 0; index < count; index += 1) {
        const item = this.parseValue(current);
        if (!item) return null;
        values.push(item.value);
        current = item.nextOffset;
      }
      return { value: values, nextOffset: current };
    }
    throw new Error(`Unsupported Redis response: ${prefix}`);
  }
}

function target(type: string) {
  const suffix = randomBytes(5).toString("hex");
  const identifier = `proj_it_${type}_${suffix}`;
  return {
    projectId: crypto.randomUUID(),
    projectSlug: `integration-${suffix}`,
    dbName: identifier,
    username: identifier,
    password: randomBytes(20).toString("base64url"),
  };
}

async function rejects(operation: Promise<unknown>): Promise<boolean> {
  try {
    await operation;
    return false;
  } catch {
    return true;
  }
}

describeInfra("project provisioning against dev infrastructure", () => {
  let mongoAdmin: MongoClient;
  let redisAdmin: TestRedisClient;
  let redisCommander: RedisCommander;

  beforeAll(async () => {
    mongoAdmin = new MongoClient(MONGO_URI);
    await mongoAdmin.connect();
    redisAdmin = new TestRedisClient(REDIS_URL);
    await redisAdmin.connect();
    redisCommander = redisAdmin;
  });

  afterAll(async () => {
    await Promise.all([mongoAdmin?.close(), redisAdmin?.close()]);
  });

  it("provisions an isolated Postgres role/database and removes both", async () => {
    const provisioner = new PostgresProvisioner(POSTGRES_URL);
    const resource = target("pg");
    try {
      await provisioner.provision(resource);
      const url = new URL(POSTGRES_URL);
      url.username = resource.username;
      url.password = resource.password;
      url.pathname = `/${resource.dbName}`;
      const client = createRawClient(url.toString(), { max: 1 });
      try {
        await client`create table boundary_test (id integer primary key, value text)`;
        await client`insert into boundary_test (id, value) values (1, 'ok')`;
        const rows = await client`select value from boundary_test where id = 1`;
        expect(rows[0]?.value).toBe("ok");
      } finally {
        await client.end();
      }

      const mainUrl = new URL(url);
      mainUrl.pathname = new URL(POSTGRES_URL).pathname;
      const boundaryClient = createRawClient(mainUrl.toString(), { max: 1 });
      try {
        expect(await rejects(boundaryClient`select * from users limit 1`)).toBe(
          true,
        );
      } finally {
        await boundaryClient.end();
      }
    } finally {
      await provisioner.deprovision(resource).catch(() => undefined);
    }

    const admin = createRawClient(POSTGRES_URL, { max: 1 });
    try {
      const rows = await admin`
        select datname from pg_database where datname = ${resource.dbName}
      `;
      expect(rows).toHaveLength(0);
    } finally {
      await admin.end();
    }
  }, 30_000);

  it("provisions an isolated MongoDB user/database and removes both", async () => {
    const provisioner = new MongoProvisioner(mongoAdmin);
    const resource = target("mongo");
    try {
      await provisioner.provision(resource);
      const uri = new URL(MONGO_URI);
      uri.username = resource.username;
      uri.password = resource.password;
      uri.searchParams.set("authSource", resource.dbName);
      const client = new MongoClient(uri.toString());
      try {
        await client.connect();
        const collection = client.db(resource.dbName).collection("documents");
        await collection.insertOne({ value: "ok" });
        expect(await collection.findOne({ value: "ok" })).not.toBeNull();
        expect(
          await rejects(
            client.db("admin").collection("forbidden").insertOne({ value: 1 }),
          ),
        ).toBe(true);
      } finally {
        await client.close();
      }
    } finally {
      await provisioner.deprovision(resource).catch(() => undefined);
    }
    const databases = await mongoAdmin.db().admin().listDatabases();
    expect(
      databases.databases.some((database) => database.name === resource.dbName),
    ).toBe(false);
  }, 30_000);

  it("provisions a prefix-scoped Redis ACL user, persists it, and revokes it", async () => {
    const provisioner = new RedisProvisioner(redisCommander);
    const resource = target("redis");
    try {
      await provisioner.provision(resource);
      const projectClient = new TestRedisClient(
        `redis://${encodeURIComponent(resource.username)}:${encodeURIComponent(resource.password)}@localhost:6380`,
      );
      try {
        await projectClient.connect();
        await projectClient.sendCommand([
          "SET",
          `${resource.dbName}:allowed`,
          "ok",
        ]);
        expect(
          await projectClient.sendCommand([
            "GET",
            `${resource.dbName}:allowed`,
          ]),
        ).toBe("ok");
        expect(
          await rejects(
            projectClient.sendCommand(["SET", "other:forbidden", "no"]),
          ),
        ).toBe(true);
      } finally {
        await projectClient.close();
      }
      expect(await redisAdmin.sendCommand(["ACL", "SAVE"])).toBe("OK");
    } finally {
      await provisioner.deprovision(resource).catch(() => undefined);
    }
    const revokedClient = new TestRedisClient(
      `redis://${encodeURIComponent(resource.username)}:${encodeURIComponent(resource.password)}@localhost:6380`,
    );
    expect(await rejects(revokedClient.connect())).toBe(true);
    await revokedClient.close();
    expect(
      await redisAdmin.sendCommand(["EXISTS", `${resource.dbName}:allowed`]),
    ).toBe(0);
  }, 30_000);

  it("restores saved Redis ACL users after a dev container restart", async () => {
    const resource = target("restart");
    await new RedisProvisioner(redisCommander).provision(resource);
    await redisAdmin.close();
    const compose = Bun.spawn(
      [
        "docker",
        "compose",
        "--env-file",
        ".env.dev",
        "-f",
        "docker-compose.dev.yml",
        "restart",
        "redis",
      ],
      {
        cwd: fileURLToPath(
          new URL("../../../../infra/compose/", import.meta.url),
        ),
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const exitCode = await compose.exited;
    if (exitCode !== 0) {
      throw new Error(await new Response(compose.stderr).text());
    }

    redisAdmin = new TestRedisClient(REDIS_URL);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await redisAdmin.connect();
        break;
      } catch {
        await redisAdmin.close();
        if (attempt === 49) throw new Error("Redis did not restart");
        await Bun.sleep(100);
      }
    }
    redisCommander = redisAdmin;
    const projectClient = new TestRedisClient(
      `redis://${encodeURIComponent(resource.username)}:${encodeURIComponent(resource.password)}@localhost:6380`,
    );
    try {
      await projectClient.connect();
      expect(
        await projectClient.sendCommand([
          "SET",
          `${resource.dbName}:restored`,
          "yes",
        ]),
      ).toBe("OK");
    } finally {
      await projectClient.close();
      await new RedisProvisioner(redisCommander)
        .deprovision(resource)
        .catch(() => undefined);
    }
  }, 60_000);
});
