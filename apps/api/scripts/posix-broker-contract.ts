/**
 * Gate 1B: does the brokered CIFS mount preserve the API's byte contracts?
 *
 * Every check runs against the broker mount, not the merged namespace, because
 * the question is whether the extra SMB hop breaks something the API depends
 * on. Read-only where it can be; anything it writes goes under a probe prefix
 * it creates and removes.
 */
import { mkdir, open, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const results: Check[] = [];
function record(name: string, ok: boolean, detail?: string) {
  results.push({ detail, name, ok });
}

const root = process.env.BROKER_ROOT ?? "/srv/deniz-cloud/api-storage";
const probe = join(root, `.probe-${process.pid}`);
const MB = 1024 * 1024;

async function main() {
  await mkdir(probe, { recursive: true });

  // 1. Bun.file full read: the shape every download uses.
  const payload = Buffer.alloc(5 * MB);
  for (let i = 0; i < payload.length; i += 4096) payload[i] = i % 251;
  const target = join(probe, "payload.bin");
  await writeFile(target, payload);

  const file = Bun.file(target);
  record("Bun.file size matches", file.size === payload.length, `${file.size}`);
  const full = Buffer.from(await file.arrayBuffer());
  record("full read byte-identical", full.equals(payload));

  // 2. Range slices: the download path's 206 responses.
  const slice = Buffer.from(await file.slice(1024, 4096).arrayBuffer());
  record(
    "range slice byte-identical",
    slice.equals(payload.subarray(1024, 4096)),
    `${slice.length} bytes`,
  );
  const tail = Buffer.from(
    await file.slice(payload.length - 512).arrayBuffer(),
  );
  record(
    "suffix range byte-identical",
    tail.equals(payload.subarray(payload.length - 512)),
  );

  // 3. Atomic same-directory rename: how TUS publishes a completed upload.
  const staged = join(probe, ".staged.partial");
  const published = join(probe, "published.bin");
  await writeFile(staged, payload.subarray(0, MB));
  try {
    const handle = await open(staged, "r+");
    await handle.sync();
    await handle.close();
    const { rename } = await import("node:fs/promises");
    await rename(staged, published);
    const publishedStat = await stat(published);
    record("atomic rename publishes", publishedStat.size === MB);
  } catch (error) {
    record("atomic rename publishes", false, String(error));
  }

  // 4. Resumable append: TUS writes a chunk at a time into one file.
  const resumable = join(probe, "resumable.bin");
  await writeFile(resumable, Buffer.alloc(0));
  try {
    for (let chunk = 0; chunk < 4; chunk += 1) {
      const handle = await open(resumable, "r+");
      await handle.write(
        payload.subarray(chunk * 1024, (chunk + 1) * 1024),
        0,
        1024,
        chunk * 1024,
      );
      await handle.sync();
      await handle.close();
    }
    const resumed = await stat(resumable);
    record(
      "resumable offsets append",
      resumed.size === 4096,
      `${resumed.size}`,
    );
  } catch (error) {
    record("resumable offsets append", false, String(error));
  }

  // 5. Descriptor read into a reused buffer: how checksums and ZIP staging
  //    read bytes without growing RSS.
  try {
    const handle = await open(target, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const hasher = new Bun.CryptoHasher("sha256");
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );
      if (bytesRead === 0) break;
      hasher.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await handle.close();
    const expected = new Bun.CryptoHasher("sha256")
      .update(payload)
      .digest("hex");
    record(
      "descriptor read checksum matches",
      hasher.digest("hex") === expected,
    );
  } catch (error) {
    record("descriptor read checksum matches", false, String(error));
  }

  // 6. RSS while streaming: the failure this codebase exists to avoid.
  const before = process.memoryUsage().rss;
  const reader = Bun.file(target).stream().getReader();
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.length;
  }
  const growth = process.memoryUsage().rss - before;
  record(
    "streaming stays bounded",
    seen === payload.length && growth < 96 * MB,
    `read ${seen}, rss +${Math.round(growth / MB)}MB`,
  );

  // 7. The broker must not expose protected metadata.
  const xattr = Bun.spawnSync(["getfattr", "-d", "-m-", target]);
  const dump = xattr.stdout.toString();
  record(
    "no protected xattrs visible through broker",
    !dump.includes("denizcloud"),
    dump.trim().split("\n").filter(Boolean).length === 0
      ? "none"
      : "some present",
  );

  await rm(probe, { force: true, recursive: true });
}

await main();
const failed = results.filter((check) => !check.ok);
for (const check of results) {
  console.log(
    `${check.ok ? "PASS" : "FAIL"}  ${check.name}${check.detail ? `  (${check.detail})` : ""}`,
  );
}
console.log(JSON.stringify({ checks: results.length, failed: failed.length }));
if (failed.length > 0) process.exit(1);
