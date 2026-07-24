import { createHmac } from "node:crypto";

import {
  authUser,
  cloudEnv,
  createDb,
  requiredEnv,
  users,
} from "@repo/cloud-core";
import { eq } from "drizzle-orm";

import { createCloudAuth } from "../src/auth/better-auth";
import { createPendingAuthUser } from "../src/auth/users";

// Drives the exact sequence apps/storage performs in a browser: complete a
// signup, enroll TOTP, then exercise every storage surface the file browser
// depends on. Run against the dev API only.

const BASE = process.env.STORAGE_E2E_BASE ?? "http://localhost:3001";
// Better Auth rejects state-changing calls without an Origin; a browser always
// sends one, so the harness has to mirror the storage app's dev origin.
const ORIGIN = process.env.STORAGE_E2E_ORIGIN ?? "http://localhost:3005";
const PASSWORD = "storage-e2e-password-1";
const username = `storage-e2e-${crypto.randomUUID().slice(0, 8)}`;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ detail, name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
}

const jar = new Map<string, string>();
function storeCookies(response: Response): void {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const index = pair?.indexOf("=") ?? -1;
    if (!pair || index < 0) continue;
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
function cookieHeader(): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function call(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; response: Response }> {
  const response = await fetch(new URL(path, BASE), {
    ...init,
    headers: {
      Origin: ORIGIN,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(jar.size > 0 ? { Cookie: cookieHeader() } : {}),
      ...(init.headers ?? {}),
    },
  });
  storeCookies(response);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON responses (archive bytes) are handled by the caller.
  }
  return { body, response, status: response.status };
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const code = digest.readUInt32BE(offset) & 0x7fff_ffff;
  return String(code % 1_000_000).padStart(6, "0");
}

function secretFromUri(uri: string): string {
  const secret = new URL(
    uri.replace("otpauth://", "https://"),
  ).searchParams.get("secret");
  if (!secret) throw new Error("TOTP URI carried no secret");
  return secret;
}

const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
let userId: string | null = null;

try {
  const auth = createCloudAuth({
    baseURL: cloudEnv("BETTER_AUTH_URL"),
    cookieDomain: process.env.COOKIE_DOMAIN,
    db,
    secret: requiredEnv("BETTER_AUTH_SECRET"),
  });
  const pending = await createPendingAuthUser(db, auth, {
    role: "user",
    username,
  });
  userId = pending.user.id;

  // 1. complete-signup ------------------------------------------------------
  const signup = await call("/api/auth/complete-signup", {
    body: JSON.stringify({
      email: `${username}@example.test`,
      password: PASSWORD,
      token: pending.signupToken,
      username,
    }),
    method: "POST",
  });
  check(
    "complete-signup returns 200",
    signup.status === 200,
    String(signup.status),
  );

  const blocked = await call("/api/storage/folders/roots");
  check(
    "storage is blocked before TOTP enrollment",
    blocked.status === 403,
    String(blocked.status),
  );

  // 2. TOTP enrollment ------------------------------------------------------
  const enable = await call("/api/auth/two-factor/enable", {
    body: JSON.stringify({ password: PASSWORD }),
    method: "POST",
  });
  const enableBody = enable.body as {
    totpURI?: string;
    backupCodes?: string[];
  };
  check(
    "two-factor/enable returns a TOTP URI and backup codes",
    enable.status === 200 &&
      typeof enableBody.totpURI === "string" &&
      (enableBody.backupCodes?.length ?? 0) > 0,
    String(enable.status),
  );

  const secret = secretFromUri(enableBody.totpURI ?? "");
  const verify = await call("/api/auth/two-factor/verify-totp", {
    body: JSON.stringify({ code: totp(secret) }),
    method: "POST",
  });
  check(
    "verify-totp returns 200",
    verify.status === 200,
    String(verify.status),
  );

  const me = await call("/api/me");
  const meBody = me.body as {
    data?: { status?: string; totpEnabled?: boolean };
  };
  check(
    "/api/me reports an active, TOTP-enabled user",
    me.status === 200 &&
      meBody.data?.status === "active" &&
      meBody.data?.totpEnabled === true,
    JSON.stringify(meBody).slice(0, 160),
  );

  // 3. roots + nested folders ----------------------------------------------
  const roots = await call("/api/storage/folders/roots");
  const rootsBody = roots.body as {
    data?: { userRoot?: { id: string; path: string } };
  };
  const userRoot = rootsBody.data?.userRoot;
  check(
    "folders/roots returns a user root",
    Boolean(userRoot?.id),
    String(roots.status),
  );
  if (!userRoot) throw new Error("no user root");

  const parent = await call("/api/storage/folders", {
    body: JSON.stringify({ name: "E2E Parent", parentId: userRoot.id }),
    method: "POST",
  });
  const parentBody = parent.body as {
    data?: { id: string; path: string; name: string };
  };
  // Matches normalizeName's snake-casing, which the browser mirrors in the
  // rename field so the stored name is never a surprise.
  check(
    "folder create normalizes the display name",
    parent.status === 201 && parentBody.data?.name === "e2_e_parent",
    JSON.stringify(parentBody).slice(0, 160),
  );
  const parentId = parentBody.data?.id ?? "";

  const child = await call("/api/storage/folders", {
    body: JSON.stringify({ name: "child", parentId }),
    method: "POST",
  });
  const childBody = child.body as { data?: { id: string; path: string } };
  const childId = childBody.data?.id ?? "";
  const childPath = childBody.data?.path ?? "";
  check("nested folder created", child.status === 201 && childId.length > 0);

  const contents = await call(`/api/storage/folders/${childId}/contents`);
  const contentsBody = contents.body as {
    data?: { ancestors?: { id: string; path: string }[] };
  };
  const ancestors = contentsBody.data?.ancestors ?? [];
  check(
    "folder contents carries a root-first ancestor chain",
    ancestors.length === 2 &&
      ancestors[0]?.path === userRoot.path &&
      ancestors[1]?.id === parentId,
    JSON.stringify(ancestors).slice(0, 200),
  );

  // 4. resumable upload -----------------------------------------------------
  // Driven over raw fetch rather than tus-js-client: this is the exact wire
  // exchange the browser performs, and it makes "interrupt then resume" a
  // deterministic pause between two PATCHes instead of a timing race.
  const payload = Buffer.from(
    `deniz-cloud storage e2e ${crypto.randomUUID()} `.repeat(40_000),
  );
  const filename = "e2e_payload.txt";
  const tusHeaders = () => ({
    Cookie: cookieHeader(),
    Origin: ORIGIN,
    "Tus-Resumable": "1.0.0",
  });

  const creation = await fetch(new URL("/api/storage/uploads", BASE), {
    headers: {
      ...tusHeaders(),
      "Upload-Length": String(payload.byteLength),
      "Upload-Metadata": Object.entries({
        filename,
        filetype: "text/plain",
        targetFolder: childPath,
      })
        .map(
          ([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`,
        )
        .join(","),
    },
    method: "POST",
  });
  const location = creation.headers.get("Location") ?? "";
  check(
    "TUS creation returns 201 with Location and Tus-Resumable",
    creation.status === 201 &&
      location.startsWith("/api/storage/uploads/") &&
      creation.headers.get("Tus-Resumable") === "1.0.0",
    `${creation.status} ${location}`,
  );
  const uploadUrl = new URL(location, BASE);

  const firstHalf = Math.floor(payload.byteLength / 2);
  const firstPatch = await fetch(uploadUrl, {
    body: payload.subarray(0, firstHalf),
    headers: {
      ...tusHeaders(),
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": "0",
    },
    method: "PATCH",
  });
  check(
    "first chunk is accepted and the new offset is advertised",
    firstPatch.status === 204 &&
      Number(firstPatch.headers.get("Upload-Offset")) === firstHalf,
    `${firstPatch.status} ${firstPatch.headers.get("Upload-Offset")}`,
  );

  const head = await fetch(uploadUrl, {
    headers: tusHeaders(),
    method: "HEAD",
  });
  const offset = Number(head.headers.get("Upload-Offset"));
  check(
    "an interrupted upload reports its persisted offset on HEAD",
    head.status === 200 &&
      offset === firstHalf &&
      Number(head.headers.get("Upload-Length")) === payload.byteLength,
    `${head.status} offset=${offset}`,
  );

  const resumePatch = await fetch(uploadUrl, {
    body: payload.subarray(offset),
    headers: {
      ...tusHeaders(),
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": String(offset),
    },
    method: "PATCH",
  });
  check(
    "resuming from the reported offset completes the upload",
    resumePatch.status === 204 &&
      Number(resumePatch.headers.get("Upload-Offset")) === payload.byteLength,
    `${resumePatch.status} ${resumePatch.headers.get("Upload-Offset")}`,
  );

  const finished = await fetch(uploadUrl, {
    headers: tusHeaders(),
    method: "HEAD",
  });
  check(
    "a finished upload is retired with 410",
    finished.status === 410,
    String(finished.status),
  );

  const listing = await call(`/api/storage/folders/${childId}/contents`);
  const listingBody = listing.body as {
    data?: { files?: { id: string; filename: string; sizeBytes: number }[] };
  };
  const uploaded = listingBody.data?.files?.[0];
  check(
    "resumed upload lands complete in the folder",
    uploaded?.filename === filename &&
      uploaded?.sizeBytes === payload.byteLength,
    JSON.stringify(uploaded).slice(0, 160),
  );
  const fileId = uploaded?.id ?? "";

  // 5. range streaming ------------------------------------------------------
  const ranged = await fetch(
    new URL(`/api/storage/files/${fileId}/download`, BASE),
    {
      headers: {
        Origin: ORIGIN,
        Cookie: cookieHeader(),
        Range: "bytes=100-199",
      },
    },
  );
  const rangedBody = await ranged.arrayBuffer();
  check(
    "range requests return 206 with the right slice",
    ranged.status === 206 &&
      rangedBody.byteLength === 100 &&
      ranged.headers.get("Content-Range") ===
        `bytes 100-199/${payload.byteLength}`,
    `${ranged.status} ${ranged.headers.get("Content-Range")} ${rangedBody.byteLength}`,
  );

  // 5b. active-content hardening -------------------------------------------
  // Anyone with an account can upload HTML and hand out a share link, so a
  // navigation to it must download rather than execute on the API origin.
  const htmlName = "e2e_payload.html";
  const htmlBody = Buffer.from("<script>window.__xss = 1</script>");
  const htmlCreate = await fetch(new URL("/api/storage/uploads", BASE), {
    headers: {
      ...tusHeaders(),
      "Upload-Length": String(htmlBody.byteLength),
      "Upload-Metadata": Object.entries({
        filename: htmlName,
        filetype: "text/html",
        targetFolder: childPath,
      })
        .map(
          ([key, value]) => `${key} ${Buffer.from(value).toString("base64")}`,
        )
        .join(","),
    },
    method: "POST",
  });
  await fetch(new URL(htmlCreate.headers.get("Location") ?? "", BASE), {
    body: htmlBody,
    headers: {
      ...tusHeaders(),
      "Content-Type": "application/offset+octet-stream",
      "Upload-Offset": "0",
    },
    method: "PATCH",
  });
  const htmlListing = await call(`/api/storage/folders/${childId}/contents`);
  const htmlFile = (
    htmlListing.body as {
      data?: { files?: { id: string; filename: string }[] };
    }
  ).data?.files?.find((entry) => entry.filename === htmlName);
  const htmlServed = await fetch(
    new URL(`/api/storage/files/${htmlFile?.id}/download`, BASE),
    { headers: { Origin: ORIGIN, Cookie: cookieHeader() } },
  );
  await htmlServed.arrayBuffer();
  check(
    "uploaded HTML is served as an attachment with nosniff, never inline",
    htmlServed.headers.get("Content-Disposition")?.startsWith("attachment") ===
      true && htmlServed.headers.get("X-Content-Type-Options") === "nosniff",
    `${htmlServed.headers.get("Content-Disposition")} / ${htmlServed.headers.get("X-Content-Type-Options")}`,
  );

  const htmlShare = await call(`/api/storage/files/${htmlFile?.id}/share`, {
    body: JSON.stringify({ expiresIn: "30m" }),
    method: "POST",
  });
  const htmlToken =
    (htmlShare.body as { data?: { token?: string } }).data?.token ?? "";
  const sharedHtml = await fetch(
    new URL(`/api/storage/share/${encodeURIComponent(htmlToken)}`, BASE),
  );
  await sharedHtml.arrayBuffer();
  check(
    "the same protection applies on the public share route",
    sharedHtml.headers.get("Content-Disposition")?.startsWith("attachment") ===
      true,
    String(sharedHtml.headers.get("Content-Disposition")),
  );

  // 6. sharing --------------------------------------------------------------
  const share = await call(`/api/storage/files/${fileId}/share`, {
    body: JSON.stringify({ expiresIn: "30m" }),
    method: "POST",
  });
  const token = (share.body as { data?: { token?: string } }).data?.token ?? "";
  check("share link minted", share.status === 200 && token.length > 0);

  const anonymousMeta = await fetch(
    new URL(`/api/storage/share/${encodeURIComponent(token)}/meta`, BASE),
  );
  const metaBody = (await anonymousMeta.json()) as {
    data?: Record<string, unknown>;
  };
  check(
    "share meta works without a session",
    anonymousMeta.status === 200 && metaBody.data?.filename === filename,
    String(anonymousMeta.status),
  );
  check(
    "share meta leaks nothing beyond filename, type and size",
    Object.keys(metaBody.data ?? {})
      .sort()
      .join(",") === "filename,mimeType,sizeBytes",
    Object.keys(metaBody.data ?? {}).join(","),
  );

  const anonymousDownload = await fetch(
    new URL(`/api/storage/share/${encodeURIComponent(token)}`, BASE),
    { headers: { Range: "bytes=0-9" } },
  );
  await anonymousDownload.arrayBuffer();
  check(
    "shared download streams without a session and honours Range",
    anonymousDownload.status === 206,
    String(anonymousDownload.status),
  );

  const badToken = await fetch(
    new URL("/api/storage/share/definitely-not-a-token/meta", BASE),
  );
  check(
    "an invalid share token is rejected",
    badToken.status === 403,
    String(badToken.status),
  );

  // 7. bulk ZIP -------------------------------------------------------------
  const archive = await fetch(new URL("/api/storage/download-archive", BASE), {
    body: JSON.stringify({ fileIds: [], folderIds: [parentId] }),
    headers: {
      Origin: ORIGIN,
      Cookie: cookieHeader(),
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const archiveBytes = new Uint8Array(await archive.arrayBuffer());
  check(
    "folder selection streams a real ZIP",
    archive.status === 200 &&
      archive.headers.get("Content-Type") === "application/zip" &&
      archiveBytes[0] === 0x50 &&
      archiveBytes[1] === 0x4b &&
      archiveBytes.byteLength > 1_000,
    `${archive.status} ${archiveBytes.byteLength} bytes`,
  );

  // 8. concurrent folder creation ------------------------------------------
  // A directory drop resolves the same folder from several parallel uploads.
  // The pre-check is read-then-write, so the losers must land on a clean 409
  // rather than a raw unique-constraint 500 — and the winner's directory must
  // survive the losers' rollback paths.
  const races = await Promise.all(
    Array.from({ length: 6 }, () =>
      call("/api/storage/folders", {
        body: JSON.stringify({ name: "race", parentId }),
        method: "POST",
      }),
    ),
  );
  const created = races.filter((race) => race.status === 201);
  const conflicted = races.filter((race) => race.status === 409);
  check(
    "concurrent creates of one name yield a single winner and clean conflicts",
    created.length === 1 && conflicted.length === races.length - 1,
    races.map((race) => race.status).join(","),
  );
  const raceFolderId =
    (created[0]?.body as { data?: { id: string } } | undefined)?.data?.id ?? "";
  const raceContents = await call(`/api/storage/folders/${raceFolderId}`);
  check(
    "the winning folder survives the losing requests' cleanup",
    raceContents.status === 200,
    String(raceContents.status),
  );

  // 9. deletes --------------------------------------------------------------
  const refused = await call(`/api/storage/folders/${parentId}`, {
    method: "DELETE",
  });
  check(
    "non-recursive delete still refuses a non-empty folder",
    refused.status === 409,
    String(refused.status),
  );

  const removed = await call(
    `/api/storage/folders/${parentId}?recursive=true`,
    { method: "DELETE" },
  );
  const removedBody = removed.body as {
    data?: { deletedFolders?: number; deletedFiles?: number };
  };
  check(
    "recursive delete removes the subtree and reports counts",
    removed.status === 200 &&
      removedBody.data?.deletedFolders === 3 &&
      removedBody.data?.deletedFiles === 2,
    JSON.stringify(removedBody).slice(0, 160),
  );

  const gone = await call(`/api/storage/folders/${childId}/contents`);
  check("deleted subtree is gone", gone.status === 404, String(gone.status));

  const orphaned = await call(`/api/storage/files/${fileId}`);
  check(
    "files under the deleted folder are gone too",
    orphaned.status === 404,
    String(orphaned.status),
  );

  const deadShare = await fetch(
    new URL(`/api/storage/share/${encodeURIComponent(token)}/meta`, BASE),
  );
  check(
    "share link to a deleted file stops resolving",
    deadShare.status === 404,
    String(deadShare.status),
  );
} finally {
  if (userId) {
    await db.delete(authUser).where(eq(authUser.id, userId));
    await db.delete(users).where(eq(users.id, userId));
  }
  await db.$client.end();
}

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length > 0) process.exit(1);
