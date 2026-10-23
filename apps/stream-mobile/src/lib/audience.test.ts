import { describe, expect, test } from "bun:test";
import type { Profile } from "@repo/schemas/stream";
import {
  audienceNames,
  editionDate,
  resolveAudience,
  toggleSofa,
} from "./audience";

const profile = (id: string, patch: Partial<Profile> = {}): Profile => ({
  id,
  name: id,
  color: "ember",
  kids: false,
  layout: "studio",
  favoriteGenres: [],
  ...patch,
});

const deniz = profile("Deniz");
const mum = profile("Mum");
const nan = profile("Nan", { layout: "classic" });
const all = [deniz, mum, nan];

describe("resolveAudience", () => {
  test("a single profile always watches, sofa or not", () => {
    expect(resolveAudience([deniz], null)).toEqual([deniz]);
    expect(resolveAudience([deniz], ["gone"])).toEqual([deniz]);
  });

  test("keeps stored profiles that still exist, in order", () => {
    expect(resolveAudience(all, ["Mum", "gone", "Deniz"])).toEqual([
      mum,
      deniz,
    ]);
  });

  test("nobody chosen means the sofa", () => {
    expect(resolveAudience(all, null)).toEqual([]);
    expect(resolveAudience(all, ["gone"])).toEqual([]);
  });

  test("a classic lead watches alone", () => {
    expect(resolveAudience(all, ["Nan", "Deniz"])).toEqual([nan]);
  });
});

describe("toggleSofa", () => {
  test("studio profiles sit down together", () => {
    const first = toggleSofa([], deniz, all);
    expect(first).toEqual({ selection: ["Deniz"], start: false });
    expect(toggleSofa(first.selection, mum, all)).toEqual({
      selection: ["Deniz", "Mum"],
      start: false,
    });
    expect(toggleSofa(["Deniz", "Mum"], deniz, all).selection).toEqual(["Mum"]);
  });

  test("a classic profile is single-select and starts at once", () => {
    expect(toggleSofa(["Deniz", "Mum"], nan, all)).toEqual({
      selection: ["Nan"],
      start: true,
    });
  });

  test("a studio tap replaces a classic choice", () => {
    expect(toggleSofa(["Nan"], mum, all).selection).toEqual(["Mum"]);
  });
});

describe("names and dates", () => {
  test("names", () => {
    expect(audienceNames([])).toBe("");
    expect(audienceNames([deniz])).toBe("Deniz");
    expect(audienceNames([deniz, mum])).toBe("Deniz & Mum");
    expect(audienceNames([deniz, mum, nan])).toBe("Deniz, Mum & Nan");
  });

  test("the edition date is a calendar day", () => {
    expect(editionDate("2026-10-22")).toBe("Thursday 22 October");
    expect(editionDate("2026-01-01")).toBe("Thursday 1 January");
  });
});
