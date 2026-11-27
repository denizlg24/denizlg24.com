/**
 * Drives /mcp on a running app with tokens inserted straight into
 * stockwatcher_access_tokens for a throwaway user: no token and a wrong token
 * are refused, read scope lists data tools only, a tool call returns data,
 * write scope adds the workspace tools.
 *
 *   bunx next dev -p 3013   (in another shell)
 *   bun --env-file=.env.local scripts/mcp-e2e.ts [http://localhost:3013]
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";

const base = process.argv[2] ?? "http://localhost:3013";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL.");
const sql = postgres(url, { max: 1, onnotice: () => {} });
const user = `e2e:${randomUUID()}`;

const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

async function token(scope: "read" | "write") {
  const secret = `swk_${randomBytes(32).toString("base64url")}`;
  await sql`
    INSERT INTO stockwatcher_access_tokens
      (id, user_id, name, scope, prefix, token_hash, created_at)
    VALUES (${randomUUID()}, ${user}, ${`e2e ${scope}`}, ${scope},
      ${secret.slice(0, 10)},
      ${createHash("sha256").update(secret).digest("hex")}, now())`;
  return secret;
}

type RpcResponse = { status: number; body: unknown };

async function rpc(
  secret: string | null,
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcResponse> {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  const data = text.startsWith("{")
    ? text
    : (text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .at(-1)
        ?.slice(5) ?? "null");
  return { status: response.status, body: JSON.parse(data) };
}

const toolNames = (body: unknown) => {
  if (!body || typeof body !== "object" || !("result" in body)) return [];
  const result = body.result;
  if (!result || typeof result !== "object" || !("tools" in result)) return [];
  return Array.isArray(result.tools)
    ? result.tools.flatMap((tool: unknown) =>
        tool && typeof tool === "object" && "name" in tool
          ? [String(tool.name)]
          : [],
      )
    : [];
};

try {
  check((await rpc(null, "tools/list")).status === 401, "no token → 401");
  check(
    (await rpc(`swk_${"x".repeat(43)}`, "tools/list")).status === 401,
    "unknown token → 401",
  );

  const read = await token("read");
  const init = await rpc(read, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1" },
  });
  check(init.status === 200, `initialize → ${init.status}`);

  const readTools = toolNames((await rpc(read, "tools/list")).body);
  check(
    readTools.includes("getQuotes") && readTools.includes("compute"),
    `read scope lists data tools (${readTools.length})`,
  );
  check(
    !readTools.includes("manageAlerts") && !readTools.includes("createChart"),
    "read scope hides write and UI tools",
  );

  const call = await rpc(read, "tools/call", {
    name: "getQuotes",
    arguments: { symbols: ["AAPL"] },
  });
  const content = JSON.stringify(call.body);
  check(
    call.status === 200 && content.includes("AAPL"),
    "getQuotes returns data",
  );

  const bad = await rpc(read, "tools/call", {
    name: "getQuotes",
    arguments: { symbols: "not-a-list" },
  });
  check(
    JSON.stringify(bad.body).includes('"isError":true'),
    "invalid arguments come back as a tool error",
  );

  const write = await token("write");
  const writeTools = toolNames((await rpc(write, "tools/list")).body);
  check(
    writeTools.includes("manageAlerts") && writeTools.includes("remember"),
    `write scope adds workspace tools (${writeTools.length})`,
  );
} finally {
  await sql`DELETE FROM stockwatcher_access_tokens WHERE user_id = ${user}`;
  await sql.end();
}

if (failures.length) {
  console.error(`${failures.length} failed`);
  process.exit(1);
}
console.log("all passed");
