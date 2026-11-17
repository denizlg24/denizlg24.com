/** Personal self-hosted SIWC connection. OAuth completes on the browser's machine. */

import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  chatgptCredentialSchema,
  chatgptTokenResponseSchema,
} from "../lib/ai-subscriptions/contract";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
if (args.includes("--help")) {
  console.log(
    "bun scripts/connect-chatgpt.ts [--output PATH] [--host-id urn:uuid:UUID]\n\nSigns in through OpenAI using the official personal/open-source SIWC preview.\nCreates an owner-only credential file to import into Dashboard → Settings → Models.\nEligibility: https://developers.openai.com/siwc/token-sharing-open-source\nUse --host-id with the dashboard's host ID when authorizing a self-hosted VM.\nThe helper prints no tokens. Never commit or share the exported credential file.",
  );
  process.exit(0);
}

const output =
  option("--output") ??
  join(homedir(), ".config", "deniz-dashboard", "chatgpt-connection.json");
let previous: ReturnType<typeof chatgptCredentialSchema.parse> | undefined;
try {
  previous = chatgptCredentialSchema.parse(
    JSON.parse(await readFile(output, "utf8")),
  );
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw new Error(
      "An existing connection file could not be read. Choose another --output path to preserve it.",
    );
  }
}
const hostId =
  option("--host-id") ??
  previous?.ext_agent_host_id ??
  `urn:uuid:${randomUUID()}`;
if (!/^urn:uuid:[a-f\d-]{36}$/i.test(hostId))
  throw new Error("--host-id must be a UUID URI from Models settings.");
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
// Keep host identity stable even if the browser sign-in fails or is cancelled.
const hostFile = `${output}.host-id`;
let persistedHost = hostId;
if (!option("--host-id") && !previous) {
  try {
    persistedHost = (await readFile(hostFile, "utf8")).trim();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}
if (!/^urn:uuid:[a-f\d-]{36}$/i.test(persistedHost))
  throw new Error("Saved host ID is invalid.");
await writeFile(hostFile, persistedHost, { mode: 0o600 });
await chmod(hostFile, 0o600);

const state = randomBytes(32).toString("base64url");
const nonce = randomBytes(32).toString("base64url");
const verifier = randomBytes(48).toString("base64url");
let redirectUri = "";
let consumed = false;
let resolveCallback: (value: URL) => void = () => {};
let rejectCallback: (error: Error) => void = () => {};
const callback = new Promise<URL>((resolve, reject) => {
  resolveCallback = resolve;
  rejectCallback = reject;
});
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", redirectUri);
  if (
    url.pathname !== "/auth/callback" ||
    url.searchParams.get("state") !== state ||
    consumed
  ) {
    response.writeHead(400, {
      "content-type": "text/plain",
      "cache-control": "no-store",
    });
    response.end("This sign-in callback could not be verified.");
    return;
  }
  consumed = true;
  response.writeHead(200, {
    "content-type": "text/plain",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'",
  });
  response.end(
    "Sign-in received. Return to the terminal to finish connecting your dashboard.",
  );
  resolveCallback(url);
});
const timeout = setTimeout(
  () => rejectCallback(new Error("Sign-in timed out. Run the helper again.")),
  10 * 60_000,
);
try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start the local callback.");
  redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  const authorization = new URL(
    "https://auth.openai.com/api/accounts/authorize",
  );
  authorization.search = new URLSearchParams({
    client_id: previous?.client_id ?? "dynamic_agent_client",
    ...(!previous ? { agent_name_hint: "Deniz Dashboard" } : {}),
    ext_agent_host_id: persistedHost,
    response_type: "code",
    redirect_uri: redirectUri,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1",
    state,
    nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  }).toString();
  console.log(
    "Complete personal subscription sign-in in your browser:\n",
    authorization.toString(),
  );
  const openCommand =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  const opener = spawn(openCommand, [authorization.toString()], {
    stdio: "ignore",
  });
  opener.on("error", () => {});
  const returned = await callback;
  if (returned.searchParams.has("error"))
    throw new Error(
      "OpenAI did not authorize plan access. Run the helper again when you are ready.",
    );
  const clientId =
    returned.searchParams.get("client_id") ?? previous?.client_id;
  const code = returned.searchParams.get("code");
  if (
    !clientId ||
    clientId === "dynamic_agent_client" ||
    !code ||
    (previous && clientId !== previous.client_id)
  )
    throw new Error("The returned registration could not be verified.");
  const response = await fetch(
    "https://auth.openai.com/api/accounts/oauth/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: "https://api.openai.com/v1",
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok)
    throw new Error(
      `OpenAI token exchange failed (${response.status}). Run the helper again.`,
    );
  const tokens = chatgptTokenResponseSchema.parse(await response.json());
  if (!tokens.id_token)
    throw new Error("OpenAI did not return an identity token.");
  const { payload } = await jwtVerify(
    tokens.id_token,
    createRemoteJWKSet(
      new URL("https://auth.openai.com/.well-known/jwks.json"),
    ),
    { issuer: "https://auth.openai.com", audience: clientId },
  );
  if (
    payload.nonce !== nonce ||
    !payload.sub ||
    (previous && previous.subject !== payload.sub)
  )
    throw new Error("OpenAI identity verification failed.");
  const record = chatgptCredentialSchema.parse({
    ...tokens,
    issuer: "https://auth.openai.com",
    subject: payload.sub,
    client_id: clientId,
    ...(typeof payload.email === "string" ? { email: payload.email } : {}),
    ext_agent_host_id: persistedHost,
    scopes: tokens.scope.split(/\s+/),
    saved_at: new Date().toISOString(),
  });
  const temporary = `${output}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, output);
  console.log(
    `Connection saved to ${output}. Import this file in Dashboard → Settings → Models.`,
  );
  console.log(
    "After import, the dashboard owns token renewal. Do not reuse this credential file in another running client.",
  );
} finally {
  clearTimeout(timeout);
  server.closeAllConnections();
  server.close();
}
