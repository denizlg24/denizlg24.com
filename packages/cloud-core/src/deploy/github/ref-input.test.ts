import { describe, expect, it } from "bun:test";

import { parseRefInput } from "./ref-input";

const REPO = { owner: "denizlg24", name: "alojamentoideal.pt" };

describe("parseRefInput", () => {
  it("takes a bare branch and a bare sha apart", () => {
    expect(parseRefInput("master", REPO)).toEqual({
      ok: true,
      input: { kind: "branch", ref: "master" },
    });
    expect(parseRefInput("a5a67ea", REPO)).toEqual({
      ok: true,
      input: { kind: "sha", ref: "a5a67ea" },
    });
  });

  it("keeps a slashed branch whole through a tree URL", () => {
    expect(
      parseRefInput(
        "https://github.com/denizlg24/alojamentoideal.pt/tree/dependabot/bun/minor-and-patch-ad1c0728bc",
        REPO,
      ),
    ).toEqual({
      ok: true,
      input: {
        kind: "branch",
        ref: "dependabot/bun/minor-and-patch-ad1c0728bc",
      },
    });
  });

  it("reads a commit URL as a sha", () => {
    expect(
      parseRefInput(
        `https://github.com/denizlg24/alojamentoideal.pt/commit/${"a".repeat(40)}`,
        REPO,
      ),
    ).toEqual({ ok: true, input: { kind: "sha", ref: "a".repeat(40) } });
  });

  it("resolves the repository root as HEAD", () => {
    expect(
      parseRefInput("https://github.com/denizlg24/alojamentoideal.pt/", REPO),
    ).toEqual({ ok: true, input: { kind: "branch", ref: "HEAD" } });
  });

  it("refuses a URL naming another repository", () => {
    expect(
      parseRefInput("https://github.com/someone/else/tree/main", REPO),
    ).toEqual({ ok: false, reason: "wrong-repository" });
  });

  it("refuses a URL that names no revision", () => {
    expect(
      parseRefInput(
        "https://github.com/denizlg24/alojamentoideal.pt/issues/4",
        REPO,
      ),
    ).toEqual({ ok: false, reason: "unrecognised" });
  });

  it("strips a fully qualified ref down to the branch", () => {
    expect(parseRefInput("refs/heads/master", REPO)).toEqual({
      ok: true,
      input: { kind: "branch", ref: "master" },
    });
  });

  it("reports an empty field as empty rather than unrecognised", () => {
    expect(parseRefInput("   ", REPO)).toEqual({ ok: false, reason: "empty" });
  });
});
