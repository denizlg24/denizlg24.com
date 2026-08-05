import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PROTECTED_XATTR_NAMESPACE } from "@repo/cloud-core";

const scripts = [
  "../../../infra/scripts/posix-storage-migrate.sh",
  "../../../infra/scripts/posix-storage-reverse.sh",
].map((path) => resolve(import.meta.dir, path));

/**
 * The protected-metadata namespace is one decision expressed in two languages.
 * Gate 1B may move it from `user.` to `security.` to make the reserved-stream
 * failure structurally impossible; if the shell executors and cloud-core
 * disagree by even one prefix, the forward migration writes metadata the
 * projector cannot read and the reverse exporter reports every entry as having
 * lost its identity.
 */
describe("protected xattr namespace", () => {
  it("is declared identically in every shell executor", async () => {
    for (const script of scripts) {
      const source = await readFile(script, "utf8");
      const declared = source.match(/^readonly xattr_ns="([^"]*)"$/m);
      expect(declared, `${script} declares no xattr_ns`).not.toBeNull();
      expect(declared?.[1]).toBe(PROTECTED_XATTR_NAMESPACE);
    }
  });

  it("leaves no hardcoded namespace behind in the executors", async () => {
    for (const script of scripts) {
      const source = await readFile(script, "utf8");
      const hardcoded = source
        .split("\n")
        .filter((line) => !line.startsWith("readonly xattr_ns="))
        .filter((line) => !line.trimStart().startsWith("#"))
        .filter((line) => /\b(user|security)\.denizcloud\./.test(line));
      expect(hardcoded, `${script} hardcodes the namespace`).toEqual([]);
    }
  });
});
