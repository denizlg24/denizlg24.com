import { describe, expect, test } from "bun:test";
import {
  ageOn,
  nutrientReferences,
  nutrientUpperLimits,
} from "./nutrient-references";

describe("nutrientReferences", () => {
  test("vitamins and minerals do not scale with body weight", () => {
    const light = nutrientReferences({ sex: "male", weightKg: 55 });
    const heavy = nutrientReferences({ sex: "male", weightKg: 110 });
    for (const key of ["a", "c", "d", "iron", "magnesium", "zinc"] as const) {
      expect(heavy[key]?.value).toBe(light[key]?.value);
    }
  });

  test("protein and amino acids scale per kg", () => {
    const refs = nutrientReferences({ weightKg: 80 });
    expect(refs.protein?.value).toBeCloseTo(64);
    expect(refs.leucine?.value).toBeCloseTo(3.12);
  });

  test("picks the DRI for sex and life stage", () => {
    expect(
      nutrientReferences({ sex: "female", ageYears: 28 }).iron?.value,
    ).toBe(18);
    expect(
      nutrientReferences({ sex: "female", ageYears: 55 }).iron?.value,
    ).toBe(8);
    expect(nutrientReferences({ sex: "male", ageYears: 40 }).iron?.value).toBe(
      8,
    );
    expect(
      nutrientReferences({ sex: "male", ageYears: 40 }).magnesium?.value,
    ).toBe(420);
    expect(nutrientReferences({ ageYears: 75 }).d?.value).toBe(20);
  });

  test("an unstated sex takes the higher value", () => {
    expect(nutrientReferences({ ageYears: 25 }).iron?.value).toBe(18);
    expect(nutrientReferences({ sex: "other" }).c?.value).toBe(90);
  });

  test("ceilings are limits and follow the calorie target", () => {
    const refs = nutrientReferences({ calories: 2700 });
    expect(refs.sodium).toEqual({ value: 2300, kind: "limit" });
    expect(refs.saturated?.kind).toBe("limit");
    expect(refs.saturated?.value).toBeCloseTo(30);
    expect(refs.addedSugar?.value).toBeCloseTo(67.5);
    expect(refs.fiber).toEqual({ value: 37.8, kind: "target" });
    expect(refs.sugar).toBeUndefined();
  });
});

describe("nutrientUpperLimits", () => {
  test("omits limits that only apply to supplements", () => {
    const limits = nutrientUpperLimits(30);
    expect(limits.magnesium).toBeUndefined();
    expect(limits.b3).toBeUndefined();
    expect(limits.folate).toBeUndefined();
    expect(limits.iron).toBe(45);
    expect(nutrientUpperLimits(60).calcium).toBe(2000);
  });
});

describe("ageOn", () => {
  test("counts whole years", () => {
    expect(ageOn("2000-10-02", "2026-10-01")).toBe(25);
    expect(ageOn("2000-10-01", "2026-10-01")).toBe(26);
    expect(ageOn("not a date", "2026-10-01")).toBeNull();
  });
});
