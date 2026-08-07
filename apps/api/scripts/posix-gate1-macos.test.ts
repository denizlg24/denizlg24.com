import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { POSIX_GATE1_SUPPORTED } from "./posix-gate1-platform";

const script = new URL(
  "../../../infra/scripts/posix-gate1-macos.sh",
  import.meta.url,
).pathname;

describe.skipIf(!POSIX_GATE1_SUPPORTED)(
  "POSIX Gate 1 macOS client contract",
  () => {
    it("requires server-side rejection for the frozen cross-platform name policy", async () => {
      const source = await readFile(script, "utf8");

      for (const event of [
        "name-policy-nfc-equivalent",
        "name-policy-casefold-equivalent",
        "windows-device-con",
        "windows-device-extension",
        "trailing-dot",
        "trailing-space",
        "ascii-control",
        "over-255-utf8-bytes",
      ]) {
        expect(source).toContain(event);
      }
      expect(source).toContain('serverRejected":false');
      expect(source).toContain('fold":"NFC plus Unicode casefold');
    });

    it("runs the name gate before transfer and replacement probes", async () => {
      const source = await readFile(script, "utf8");
      const nameGate = source.indexOf(
        'run_probe "cross-platform-name-policy" probe_name_policy',
      );

      expect(nameGate).toBeGreaterThan(0);
      expect(nameGate).toBeLessThan(
        source.indexOf('run_probe "upload-download-sha256"'),
      );
    });
  },
);
