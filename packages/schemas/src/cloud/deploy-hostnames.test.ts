import { describe, expect, it } from "bun:test";

import {
  assertDeployHostname,
  DeployHostnameError,
  isReservedDeployLabel,
  MAX_HOSTNAME_LABEL_LENGTH,
  previewHostnameLabel,
  randomHostnameSuffix,
  slugifyHostnameLabel,
} from "./deploy";

const ZONE = "denizlg24.com";

describe("assertDeployHostname", () => {
  it("accepts a single-level name in the managed zone", () => {
    expect(assertDeployHostname("My-App.DenizLG24.com", ZONE)).toBe(
      "my-app.denizlg24.com",
    );
  });

  it("refuses a name that would take live infrastructure down", () => {
    for (const label of ["api", "cloud", "storage", "www", "_dmarc"]) {
      expect(() => assertDeployHostname(`${label}.${ZONE}`, ZONE)).toThrow(
        DeployHostnameError,
      );
    }
  });

  it("refuses the zone apex", () => {
    expect(() => assertDeployHostname(ZONE, ZONE)).toThrow(/apex/);
  });

  it("allows the apex only when the caller asks for it", () => {
    // Every derived hostname — project slug, preview branch — goes through the
    // default, where the apex can only be an accident. The explicit
    // add-a-domain route is the one caller that opts in.
    expect(assertDeployHostname(ZONE, ZONE, { allowApex: true })).toBe(ZONE);
    expect(
      assertDeployHostname(`  ${ZONE.toUpperCase()} `, ZONE, {
        allowApex: true,
      }),
    ).toBe(ZONE);
  });

  it("still applies every other rule to the apex", () => {
    expect(() =>
      assertDeployHostname("not a hostname", ZONE, { allowApex: true }),
    ).toThrow();
    expect(() =>
      assertDeployHostname(`www.${ZONE}`, ZONE, { allowApex: true }),
    ).toThrow(/reserved/);
  });

  it("refuses a second level, which Universal SSL does not cover", () => {
    expect(() => assertDeployHostname(`app.dpl.${ZONE}`, ZONE)).toThrow(
      /Universal SSL/,
    );
  });

  it("leaves the reserved list to the managed zone", () => {
    // `api.clientsite.com` is the client's business, not ours.
    expect(assertDeployHostname("api.clientsite.com", ZONE)).toBe(
      "api.clientsite.com",
    );
  });

  it("refuses a label over 63 characters", () => {
    const label = "a".repeat(MAX_HOSTNAME_LABEL_LENGTH + 1);
    expect(() => assertDeployHostname(`${label}.${ZONE}`, ZONE)).toThrow(
      /1–63 characters/,
    );
  });

  it("refuses a label that is not a valid hostname label", () => {
    for (const bad of [`-app.${ZONE}`, `app-.${ZONE}`, `ap p.${ZONE}`]) {
      expect(() => assertDeployHostname(bad, ZONE)).toThrow(
        DeployHostnameError,
      );
    }
  });

  it("refuses a bare label with no domain", () => {
    expect(() => assertDeployHostname("app", ZONE)).toThrow(/domain/);
  });
});

describe("isReservedDeployLabel", () => {
  it("is case insensitive", () => {
    expect(isReservedDeployLabel("API")).toBe(true);
    expect(isReservedDeployLabel("my-app")).toBe(false);
  });
});

describe("slugifyHostnameLabel", () => {
  it("flattens a branch name into one label", () => {
    expect(slugifyHostnameLabel("feat/Deploy_Agent")).toBe("feat-deploy-agent");
    expect(slugifyHostnameLabel("--weird--")).toBe("weird");
  });
});

describe("previewHostnameLabel", () => {
  it("reads as slug, branch, suffix", () => {
    expect(
      previewHostnameLabel({
        projectSlug: "my-app",
        branch: "refs/heads/feat/x",
        suffix: "abc123",
      }),
    ).toBe("my-app-refs-heads-feat-x-abc123");
  });

  it("truncates the branch and never the suffix", () => {
    const label = previewHostnameLabel({
      projectSlug: "a".repeat(20),
      branch: "b".repeat(80),
      suffix: "abc123",
    });
    expect(label.length).toBeLessThanOrEqual(MAX_HOSTNAME_LABEL_LENGTH);
    expect(label.endsWith("-abc123")).toBe(true);
    expect(label.startsWith("a".repeat(20))).toBe(true);
  });

  it("keeps the suffix even when the slug alone fills the label", () => {
    const label = previewHostnameLabel({
      projectSlug: "a".repeat(80),
      branch: "main",
      suffix: "abc123",
    });
    expect(label.length).toBeLessThanOrEqual(MAX_HOSTNAME_LABEL_LENGTH);
    expect(label.endsWith("-abc123")).toBe(true);
  });

  it("never leaves a trailing hyphen where it truncated", () => {
    const label = previewHostnameLabel({
      projectSlug: "app",
      branch: `${"b".repeat(50)}-tail`,
      suffix: "abc123",
    });
    expect(label).not.toContain("--");
    expect(assertDeployHostname(`${label}.${ZONE}`, ZONE)).toContain(label);
  });

  it("still produces a valid label from an unsluggable branch", () => {
    const label = previewHostnameLabel({
      projectSlug: "app",
      branch: "///",
      suffix: "abc123",
    });
    expect(label).toBe("app-abc123");
  });
});

describe("randomHostnameSuffix", () => {
  it("is six lowercase base36 characters", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(randomHostnameSuffix()).toMatch(/^[0-9a-z]{6}$/);
    }
  });
});
