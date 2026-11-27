#!/usr/bin/env bun
/**
 * Decides which targets of a workflow a pull request can affect, so a lockfile
 * or docs change does not rebuild apps whose inputs did not move.
 *
 *   bun scripts/ci/gate.ts <gate> [base-sha]
 *
 * Prints `any=<bool>`, `ids=<csv>` and `matrix=<json>` for $GITHUB_OUTPUT.
 * Without a base (anything but a pull request) or with a diff that cannot be
 * trusted, every target is selected.
 */
import { Glob } from "bun";
import { type GateTarget, gates } from "./gates";

const LOCKFILE = "bun.lock";
const ROOT_MANIFEST = "package.json";

export interface Selection {
  targets: GateTarget[];
  reason: string;
}

const isDocumentation = (path: string) => path.endsWith(".md");

const matchesAny = (path: string, patterns: string[]) =>
  patterns.some((pattern) => new Glob(pattern).match(path));

export function selectTargets(
  gate: string,
  targets: GateTarget[],
  changed: string[],
  lockfileAffected: ReadonlySet<string> | null,
): Selection {
  const relevant = changed.filter((path) => !isDocumentation(path));
  const selfChanged = relevant.some(
    (path) =>
      path === `.github/workflows/${gate}.yml` ||
      path === "scripts/ci/gate.ts" ||
      path === "scripts/ci/gates.ts",
  );
  if (selfChanged) return { targets, reason: "gate definition changed" };
  if (relevant.includes(ROOT_MANIFEST)) {
    return { targets, reason: "root package.json changed" };
  }

  const lockfileChanged = relevant.includes(LOCKFILE);
  if (lockfileChanged && lockfileAffected === null) {
    return { targets, reason: "lockfile changed and turbo was unavailable" };
  }

  const selected = targets.filter(
    (target) =>
      relevant.some((path) => matchesAny(path, target.paths)) ||
      (lockfileChanged &&
        target.packages.some((name) => lockfileAffected?.has(name))),
  );
  return { targets: selected, reason: "path and lockfile analysis" };
}

async function run(
  command: string[],
  env: Record<string, string> = {},
): Promise<{ ok: boolean; stdout: string }> {
  const proc = Bun.spawn(command, {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = await new Response(proc.stdout).text();
  return { ok: (await proc.exited) === 0, stdout };
}

async function changedFiles(base: string): Promise<string[] | null> {
  const known = await run(["git", "cat-file", "-e", `${base}^{commit}`]);
  if (!known.ok) return null;
  const diff = await run([
    "git",
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    base,
    "HEAD",
  ]);
  if (!diff.ok) return null;
  return diff.stdout.split("\0").filter(Boolean);
}

/** The pinned turbo, so the gate can run before any dependency is installed. */
async function turboVersion(): Promise<string | null> {
  const lock = await Bun.file(LOCKFILE).text();
  return lock.match(/"turbo": \["turbo@(\d+\.\d+\.\d+)"/)?.[1] ?? null;
}

async function affectedPackages(base: string): Promise<Set<string> | null> {
  const version = await turboVersion();
  if (!version) return null;
  const result = await run(
    ["bunx", `turbo@${version}`, "ls", "--affected", "--output=json"],
    {
      TURBO_SCM_BASE: base,
      TURBO_SCM_HEAD: "HEAD",
      TURBO_TELEMETRY_DISABLED: "1",
    },
  );
  if (!result.ok) return null;
  try {
    const parsed: { packages: { items: { name: string }[] } } = JSON.parse(
      result.stdout.slice(result.stdout.indexOf("{")),
    );
    return new Set(parsed.packages.items.map((item) => item.name));
  } catch {
    return null;
  }
}

function format(selection: Selection): string[] {
  return [
    `any=${selection.targets.length > 0}`,
    `ids=${selection.targets.map((target) => target.id).join(",")}`,
    `matrix=${JSON.stringify({
      include: selection.targets.map((target) => ({
        id: target.id,
        ...target.matrix,
      })),
    })}`,
  ];
}

async function main() {
  const [gate, baseArg] = process.argv.slice(2);
  const targets = gate ? gates[gate] : undefined;
  if (!gate || !targets) {
    console.error(
      `Unknown gate "${gate}". Known: ${Object.keys(gates).join(", ")}`,
    );
    process.exit(2);
  }

  const everything = (reason: string): Selection => ({ targets, reason });
  let selection: Selection;
  const base = baseArg ?? "";
  const changed = base ? await changedFiles(base) : null;
  if (!changed) {
    selection = everything(base ? "no reliable diff" : "not a pull request");
  } else {
    const affected = changed.includes(LOCKFILE)
      ? await affectedPackages(base)
      : new Set<string>();
    selection = selectTargets(gate, targets, changed, affected);
  }
  console.error(
    `gate ${gate}: ${selection.targets.map((target) => target.id).join(", ") || "none"} (${selection.reason})`,
  );
  for (const line of format(selection)) console.log(line);
}

if (import.meta.main) await main();
