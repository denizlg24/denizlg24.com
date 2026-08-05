/**
 * Reading and writing extended attributes.
 *
 * Bun exposes no xattr syscall binding, so the real backend shells out to
 * attr(1). That is acceptable here because protected metadata is touched once
 * per entry mutation and on projection scans — not on the byte path — and the
 * alternative is a native addon in a runtime that has to stay `bun build
 * --compile`-able for the host service.
 *
 * The interface exists so every consumer is testable on a machine with neither
 * `security.*` support nor attr(1) installed.
 */
export interface XattrBackend {
  get(path: string, key: string): Promise<string | null>;
  list(path: string): Promise<Record<string, string>>;
  set(path: string, key: string, value: string): Promise<void>;
  remove(path: string, key: string): Promise<void>;
}

export class XattrError extends Error {
  constructor(
    message: string,
    readonly code: "UNSUPPORTED" | "DENIED" | "IO",
  ) {
    super(message);
    this.name = "XattrError";
  }
}

function classify(stderr: string): "UNSUPPORTED" | "DENIED" | "IO" {
  if (/Operation not supported/i.test(stderr)) return "UNSUPPORTED";
  if (/Permission denied|Operation not permitted/i.test(stderr)) {
    return "DENIED";
  }
  return "IO";
}

async function run(
  cmd: string[],
): Promise<{ code: number; stderr: string; stdout: string }> {
  const child = Bun.spawn(cmd, { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stderr, stdout };
}

export class AttrCommandXattrBackend implements XattrBackend {
  async get(path: string, key: string): Promise<string | null> {
    const { code, stderr, stdout } = await run([
      "getfattr",
      "--only-values",
      "--absolute-names",
      "-n",
      key,
      "--",
      path,
    ]);
    if (code === 0) return stdout;
    // A key that is simply absent is not an error; every other failure is.
    if (/No such attribute|No data available/i.test(stderr)) return null;
    throw new XattrError(
      `getfattr ${key} on ${path} failed: ${stderr.trim()}`,
      classify(stderr),
    );
  }

  async list(path: string): Promise<Record<string, string>> {
    const { code, stderr, stdout } = await run([
      "getfattr",
      "-d",
      "-m-",
      "--absolute-names",
      "--",
      path,
    ]);
    if (code !== 0) {
      throw new XattrError(
        `getfattr -d on ${path} failed: ${stderr.trim()}`,
        classify(stderr),
      );
    }
    const values: Record<string, string> = {};
    for (const line of stdout.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator === -1) continue;
      const key = line.slice(0, separator);
      const raw = line.slice(separator + 1);
      values[key] =
        raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
    return values;
  }

  async set(path: string, key: string, value: string): Promise<void> {
    const { code, stderr } = await run([
      "setfattr",
      "-n",
      key,
      "-v",
      value,
      "--",
      path,
    ]);
    if (code !== 0) {
      throw new XattrError(
        `setfattr ${key} on ${path} failed: ${stderr.trim()}`,
        classify(stderr),
      );
    }
  }

  async remove(path: string, key: string): Promise<void> {
    const { code, stderr } = await run(["setfattr", "-x", key, "--", path]);
    if (code === 0) return;
    if (/No such attribute|No data available/i.test(stderr)) return;
    throw new XattrError(
      `setfattr -x ${key} on ${path} failed: ${stderr.trim()}`,
      classify(stderr),
    );
  }
}

/** In-memory backend for tests and for probing behaviour off-Linux. */
export class InMemoryXattrBackend implements XattrBackend {
  readonly entries = new Map<string, Map<string, string>>();

  private bucket(path: string): Map<string, string> {
    const existing = this.entries.get(path);
    if (existing) return existing;
    const created = new Map<string, string>();
    this.entries.set(path, created);
    return created;
  }

  async get(path: string, key: string): Promise<string | null> {
    return this.entries.get(path)?.get(key) ?? null;
  }

  async list(path: string): Promise<Record<string, string>> {
    return Object.fromEntries(this.entries.get(path) ?? []);
  }

  async set(path: string, key: string, value: string): Promise<void> {
    this.bucket(path).set(key, value);
  }

  async remove(path: string, key: string): Promise<void> {
    this.entries.get(path)?.delete(key);
  }
}
