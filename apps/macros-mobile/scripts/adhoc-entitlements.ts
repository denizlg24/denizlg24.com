/**
 * Fails when a signed ad-hoc target carries an entitlement it should not, is
 * debuggable, or lacks one it needs (push, HealthKit and the App Group on the
 * app; the App Group alone on the widget extension). macOS only (`codesign`,
 * `plutil`).
 *
 *   bun scripts/adhoc-entitlements.ts build/Payload/Macros.app
 *   bun scripts/adhoc-entitlements.ts --target MacrosWidgetExtension \
 *     build/Payload/Macros.app/PlugIns/MacrosWidgetExtension.appex
 *   bun scripts/adhoc-entitlements.ts --unsigned ios/Macros/Macros.entitlements
 *
 * `--unsigned` reads the file prebuild generated instead of the signature, so
 * the unsigned CI build checks the same allowlist before any secret is used.
 * `--target` names the Xcode target; the app is the default.
 */
import { parseArgs } from "node:util";
import { entitlementProblems, signingTarget } from "./app-store-connect";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    unsigned: { type: "boolean", default: false },
    target: { type: "string", default: "Macros" },
  },
});
const unsigned = values.unsigned;
const target = positionals[0];
if (!target) {
  throw new Error(
    "Usage: adhoc-entitlements.ts [--target <name>] <path to .app or .appex> | [--target <name>] --unsigned <path to .entitlements>",
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
const problems = entitlementProblems(entitlements, {
  signed: !unsigned,
  target: signingTarget(values.target),
});
for (const problem of problems) console.log(`::error::${problem}`);
if (problems.length > 0) process.exit(1);
