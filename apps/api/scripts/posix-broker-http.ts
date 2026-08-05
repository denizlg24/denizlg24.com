/**
 * Gate 1B: does the download path itself work over the broker?
 *
 * The earlier contract probe read bytes explicitly with `arrayBuffer()` and
 * `slice()`, which passed — but every real download is
 * `new Response(Bun.file(path))`, which hands the descriptor to the runtime and
 * lets it use sendfile. That is a different kernel path, and over CIFS it was
 * observed returning a valid handle and zero bytes.
 *
 * This serves real files over real HTTP and reads them back, because that is
 * the only shape that answers the question.
 */
import { open } from "node:fs/promises";
import { join } from "node:path";

interface Check {
  detail: string;
  name: string;
  ok: boolean;
}

const results: Check[] = [];
const record = (name: string, ok: boolean, detail = "") =>
  results.push({ detail, name, ok });

const root = process.env.BROKER_ROOT ?? "/srv/deniz-cloud/api-storage";
const probeDir = join(root, `.http-probe-${process.pid}`);
const MB = 1024 * 1024;

/** Mirrors StorageService.fileResponse: whole file, then a Range slice. */
function serve(path: string, size: number, range: string | null): Response {
  const file = Bun.file(path);
  if (!range) {
    return new Response(file, {
      headers: { "Content-Length": String(size) },
    });
  }
  const match = range.match(/^bytes=(\d+)-(\d*)$/);
  const start = Number(match?.[1] ?? 0);
  const end = match?.[2] ? Number(match[2]) : size - 1;
  return new Response(file.slice(start, end + 1), {
    headers: {
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
    },
    status: 206,
  });
}

async function main() {
  const { mkdir, rm, writeFile } = await import("node:fs/promises");
  await mkdir(probeDir, { recursive: true });

  // Sizes that cross the boundaries that matter: tiny, a page, and large
  // enough that a streaming path is actually exercised.
  const sizes = [120, 64 * 1024, 5 * MB];
  const files: { expected: Buffer; path: string; size: number }[] = [];
  for (const size of sizes) {
    const payload = Buffer.alloc(size);
    for (let index = 0; index < size; index += 1) payload[index] = index % 251;
    const path = join(probeDir, `p-${size}.bin`);
    await writeFile(path, payload);
    files.push({ expected: payload, path, size });
  }

  const server = Bun.serve({
    fetch(request) {
      const url = new URL(request.url);
      const target = files.find((file) => url.pathname === `/${file.size}`);
      if (!target) return new Response("no", { status: 404 });
      return serve(target.path, target.size, request.headers.get("Range"));
    },
    port: 0,
  });
  const base = `http://127.0.0.1:${server.port}`;

  for (const file of files) {
    const response = await fetch(`${base}/${file.size}`);
    const body = Buffer.from(await response.arrayBuffer());
    record(
      `full download ${file.size}B`,
      body.length === file.size && body.equals(file.expected),
      `got ${body.length}B, content-length ${response.headers.get("content-length")}`,
    );

    const ranged = await fetch(`${base}/${file.size}`, {
      headers: { Range: "bytes=10-109" },
    });
    const slice = Buffer.from(await ranged.arrayBuffer());
    record(
      `range download ${file.size}B`,
      ranged.status === 206 &&
        slice.length === 100 &&
        slice.equals(file.expected.subarray(10, 110)),
      `status ${ranged.status}, got ${slice.length}B`,
    );
  }

  // A slow client: the shape that previously OOM'd the process on the old
  // layout, and the one where sendfile behaviour matters most.
  const slow = files.at(-1) as (typeof files)[number];
  const before = process.memoryUsage().rss;
  const response = await fetch(`${base}/${slow.size}`);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.length;
    await Bun.sleep(1);
  }
  const growth = process.memoryUsage().rss - before;
  record(
    "slow client reads every byte",
    seen === slow.size,
    `${seen}/${slow.size}B, rss +${Math.round(growth / MB)}MB`,
  );

  // Descriptor read as a control: proves the bytes are on disk regardless of
  // what the HTTP path did.
  const handle = await open(slow.path, "r");
  const buffer = Buffer.alloc(slow.size);
  const { bytesRead } = await handle.read(buffer, 0, slow.size, 0);
  await handle.close();
  record("descriptor control read", bytesRead === slow.size, `${bytesRead}B`);

  server.stop();
  await rm(probeDir, { force: true, recursive: true });
}

await main();
for (const check of results) {
  console.log(
    `${check.ok ? "PASS" : "FAIL"}  ${check.name}${check.detail ? `  (${check.detail})` : ""}`,
  );
}
const failed = results.filter((check) => !check.ok).length;
console.log(JSON.stringify({ checks: results.length, failed }));
if (failed > 0) process.exit(1);
