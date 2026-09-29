/**
 * Fails when a signed ad-hoc Macros.app carries an entitlement it should not,
 * is debuggable, or lacks push or HealthKit. macOS only (`codesign`, `plutil`).
 *
 *   bun scripts/adhoc-entitlements.ts build/Payload/Macros.app
 *   bun scripts/adhoc-entitlements.ts --unsigned ios/Macros/Macros.entitlements
 *
 * `--unsigned` reads the file prebuild generated instead of the signature, so
 * the unsigned CI build checks the same allowlist before any secret is used.
 */
import { entitlementProblems } from "./app-store-connect";

const unsigned = process.argv[2] === "--unsigned";
const target = unsigned ? process.argv[3] : process.argv[2];
if (!target) {
  throw new Error(
    "Usage: adhoc-entitlements.ts <path to .app> | --unsigned <path to .entitlements>",
  );
}

function run(command: string[], input?: Buffer): Buffer {
  const result = Bun.spawnSync(command, { stdin: input });
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} failed: ${result.stderr.toString()}`);
  }
  return result.stdout;
}

const json = unsigned
  ? run(["plutil", "-convert", "json", "-o", "-", target])
  : run(
      ["plutil", "-convert", "json", "-o", "-", "-"],
      run(["codesign", "-d", "--entitlements", "-", "--xml", target]),
    );
const parsed: unknown = JSON.parse(json.toString());
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  throw new Error("The entitlements are not a dictionary");
}
const entitlements: Record<string, unknown> = Object.fromEntries(
  Object.entries(parsed),
);

console.log(JSON.stringify(entitlements, null, 2));
const problems = entitlementProblems(entitlements, { signed: !unsigned });
for (const problem of problems) console.log(`::error::${problem}`);
if (problems.length > 0) process.exit(1);
