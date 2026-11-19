import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

const issuer = "http://127.0.0.1:3291/oidc";
const app = "http://127.0.0.1:3290";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const kid = "stockwatcher-test";
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid,
  alg: "EdDSA",
  use: "sig",
};
const exchanges = new Map();
const tokens = new Map();
const encode = (data) =>
  Buffer.from(JSON.stringify(data)).toString("base64url");

function jwt(identity, flow) {
  const now = Math.floor(Date.now() / 1000);
  const base = `${encode({ alg: "EdDSA", kid })}.${encode({ ...identity, iss: issuer, aud: "TestStockwatcherClient", iat: now, exp: now + 300, nonce: flow.nonce })}`;
  return `${base}.${sign(null, Buffer.from(base), privateKey).toString("base64url")}`;
}

createServer(async (request, response) => {
  const url = new URL(request.url, issuer);
  const json = (data, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  if (url.pathname.endsWith("/.well-known/openid-configuration"))
    return json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["EdDSA"],
      code_challenge_methods_supported: ["S256"],
    });
  if (url.pathname === "/oidc/jwks") return json({ keys: [jwk] });
  if (url.pathname === "/oidc/authorize") {
    const flow = Object.fromEntries(url.searchParams);
    if (
      flow.redirect_uri !== `${app}/auth/callback` ||
      flow.client_id !== "TestStockwatcherClient" ||
      flow.scope !== "openid profile email" ||
      flow.code_challenge_method !== "S256" ||
      !flow.state ||
      !flow.nonce ||
      !flow.code_challenge
    ) {
      return json({ error: "invalid_request" }, 400);
    }
    const links = ["Alice", "Bob"].map((name) => {
      const code = randomUUID();
      exchanges.set(code, { ...flow, name });
      return `<p><a href="${app}/auth/callback?code=${code}&amp;state=${encodeURIComponent(flow.state)}">Continue as ${name}</a></p>`;
    });
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html lang="en"><title>Deniz Cloud test issuer</title>${links.join("")}</html>`,
    );
    return;
  }
  if (url.pathname === "/oidc/token") {
    let body = "";
    for await (const chunk of request) body += chunk;
    const form = new URLSearchParams(body);
    const code = form.get("code");
    const flow = exchanges.get(code);
    exchanges.delete(code);
    const challenge = createHash("sha256")
      .update(form.get("code_verifier") ?? "")
      .digest("base64url");
    if (
      !flow ||
      form.get("grant_type") !== "authorization_code" ||
      request.headers.authorization !==
        `Basic ${Buffer.from(`${flow.client_id}:TestStockwatcherSecret`).toString("base64")}` ||
      form.get("redirect_uri") !== flow.redirect_uri ||
      challenge !== flow.code_challenge
    ) {
      return json({ error: "invalid_grant" }, 400);
    }
    const identity = {
      sub: flow.name.toLowerCase(),
      name: flow.name,
      email: `${flow.name.toLowerCase()}@example.test`,
    };
    const access = randomUUID();
    tokens.set(access, identity);
    return json({
      access_token: access,
      token_type: "Bearer",
      expires_in: 300,
      id_token: jwt(identity, flow),
    });
  }
  if (url.pathname === "/oidc/userinfo") {
    const identity = tokens.get(
      request.headers.authorization?.replace(/^Bearer /, ""),
    );
    return identity ? json(identity) : json({ error: "invalid_token" }, 401);
  }
  return json({}, 404);
}).listen(3291, "127.0.0.1");
