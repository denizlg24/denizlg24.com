import { describe, expect, test } from "bun:test";

import {
  barcodeAliases,
  barcodeLookupKeys,
  expandUpcE,
  hasValidGtinCheckDigit,
  normalizeBarcode,
} from "./barcode";

describe("normalizeBarcode", () => {
  test("pads every GTIN width to fourteen digits", () => {
    expect(normalizeBarcode("012345678905")).toBe("00012345678905");
    expect(normalizeBarcode("0012345678905")).toBe("00012345678905");
    expect(normalizeBarcode("5449000000996")).toBe("05449000000996");
    expect(normalizeBarcode("96385074")).toBe("00000096385074");
  });

  test("strips whitespace and hyphens", () => {
    expect(normalizeBarcode(" 5449000-000996 ")).toBe("05449000000996");
  });

  test("keeps non-GTIN codes as written", () => {
    expect(normalizeBarcode("usda:01001")).toBe("usda:01001");
    expect(normalizeBarcode("123456789012345")).toBe("123456789012345");
  });
});

describe("check digits", () => {
  test("validates EAN-13, UPC-A and EAN-8", () => {
    expect(hasValidGtinCheckDigit("5449000000996")).toBe(true);
    expect(hasValidGtinCheckDigit("012345678905")).toBe(true);
    expect(hasValidGtinCheckDigit("96385074")).toBe(true);
    expect(hasValidGtinCheckDigit("5449000000997")).toBe(false);
  });
});

describe("expandUpcE", () => {
  test("expands each zero-suppression pattern", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
    expect(expandUpcE("425261")).toBe("042100005264");
    expect(expandUpcE("01234565")).toBe("012345000065");
  });

  test("rejects a wrong check digit and number systems other than 0/1", () => {
    expect(expandUpcE("04252615")).toBeUndefined();
    expect(expandUpcE("24252614")).toBeUndefined();
  });
});

describe("barcodeLookupKeys", () => {
  test("puts the normalized key first for a plain EAN-13", () => {
    expect(barcodeLookupKeys("5449000000996")[0]).toBe("05449000000996");
  });

  test("prefers the UPC-A expansion when an 8-digit read is not a valid EAN-8", () => {
    const keys = barcodeLookupKeys("04252614");
    expect(keys[0]).toBe("00042100005264");
    expect(keys).toContain("00000004252614");
  });

  test("keeps EAN-8 first when the 8-digit read is a valid EAN-8", () => {
    expect(barcodeLookupKeys("96385074")[0]).toBe("00000096385074");
  });

  test("adds the completed form for a code missing its check digit", () => {
    expect(barcodeLookupKeys("544900000099")).toContain("05449000000996");
  });

  test("falls back to the raw spelling for legacy rows", () => {
    expect(barcodeLookupKeys("5449000000996")).toContain("5449000000996");
  });
});

describe("barcodeAliases", () => {
  test("completes a stored code that lacks its check digit", () => {
    expect(barcodeAliases("544900000099")).toEqual(["05449000000996"]);
  });

  test("completes an already padded code without growing past fourteen digits", () => {
    expect(barcodeAliases("00544900000099")).toEqual(["05449000000996"]);
  });

  test("adds nothing for a valid GTIN or a namespaced id", () => {
    expect(barcodeAliases("5449000000996")).toEqual([]);
    expect(barcodeAliases("usda:01001")).toEqual([]);
  });
});
