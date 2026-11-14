import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../../../infra/scripts/posix-storage-host.sh"),
  "utf8",
);
const start = source.indexOf("service_is_active() {");
const helper = source.slice(start, source.indexOf("\n}\n", start) + 3);
const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")(
  "watchdog service observations",
  () => {
    function observe(states: string[]) {
      const dir = mkdtempSync(join(tmpdir(), "storage-watchdog-"));
      directories.push(dir);
      const sequence = join(dir, "sequence");
      const calls = join(dir, "calls");
      writeFileSync(sequence, `${states.join("\n")}\n`);
      writeFileSync(calls, "0");
      const script = `set -euo pipefail
${helper}
sequence=$1
calls=$2
systemctl() {
  local count state
  count=$(cat "$calls")
  count=$((count + 1))
  printf '%s' "$count" > "$calls"
  state=$(sed -n "${"$"}{count}p" "$sequence")
  if [[ "$state" == transport-error ]]; then
    echo 'Message recipient disconnected from message bus without replying' >&2
    return 1
  fi
  printf '%s\\n' "$state"
}
sleep() { :; }
service_is_active deniz-cloud-storage-metadata.service
`;
      const result = Bun.spawnSync(
        ["bash", "-c", script, "watchdog-test", sequence, calls],
        { stderr: "pipe", timeout: 2000 },
      );
      return {
        status: result.exitCode,
        attempts: Number(readFileSync(calls, "utf8")),
        error: result.stderr.toString(),
      };
    }

    it("retries a D-Bus transport failure without withdrawing a healthy service", () => {
      expect(observe(["transport-error", "active"])).toMatchObject({
        status: 0,
        attempts: 2,
      });
    });
    it("accepts a healthy service immediately", () => {
      expect(observe(["active"])).toMatchObject({ status: 0, attempts: 1 });
    });
    for (const state of ["inactive", "failed", "deactivating"])
      it(`fails immediately for an observed ${state} service`, () => {
        expect(observe([state, "active"])).toMatchObject({
          status: 1,
          attempts: 1,
        });
      });
    it("fails closed after persistent observation failures", () => {
      const result = observe([
        "transport-error",
        "transport-error",
        "transport-error",
        "active",
      ]);
      expect(result).toMatchObject({ status: 1, attempts: 3 });
      expect(result.error).toContain("three observations");
    });
    it("bounds retries for unknown or transitional states", () => {
      expect(observe(["activating", "active"])).toMatchObject({
        status: 0,
        attempts: 2,
      });
      expect(observe(["", "", ""])).toMatchObject({ status: 1, attempts: 3 });
    });
  },
);
