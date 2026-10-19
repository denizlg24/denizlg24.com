import { describe, expect, test } from "bun:test";
import { isPlausibleBarcode } from "./barcode";

describe("isPlausibleBarcode", () => {
  test("accepts valid check digits", () => {
    expect(isPlausibleBarcode("4006381333931", "ean13")).toBe(true);
    expect(isPlausibleBarcode("96385074", "ean8")).toBe(true);
    expect(isPlausibleBarcode("036000291452", "upc_a")).toBe(true);
  });

  test("rejects misreads", () => {
    expect(isPlausibleBarcode("4006381333932", "ean13")).toBe(false);
    expect(isPlausibleBarcode("12345", "ean13")).toBe(false);
    expect(isPlausibleBarcode("40063813339a1", "ean13")).toBe(false);
  });
});
