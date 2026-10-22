import { describe, expect, it } from "bun:test";
import { type Donor, offeredPortions, pickDonor } from "./donors";

const donor = (overrides: Partial<Donor>): Donor => ({
  id: "donor",
  source: "usda_sr_legacy",
  conceptName: "cabbage, raw",
  clusterKey: null,
  calories: 25,
  portions: [{ label: "1 head", grams: 908 }],
  ...overrides,
});

const byConcept = (donors: Donor[]) => {
  const map = new Map<string, Donor[]>();
  for (const entry of donors) {
    const key = entry.conceptName ?? "";
    map.set(key, [...(map.get(key) ?? []), entry]);
  }
  return map;
};

const gap = {
  id: "gap",
  source: "ciqual",
  conceptName: "cabbage, raw",
  clusterKey: null,
  calories: 27,
};

describe("pickDonor", () => {
  it("prefers a cluster sibling over a better-ranked table", () => {
    const foundation = donor({ id: "f", source: "usda_foundation" });
    const sibling = donor({ id: "s", source: "cnf", clusterKey: "c:1" });
    expect(
      pickDonor({ ...gap, clusterKey: "c:1" }, byConcept([foundation, sibling]))
        ?.id,
    ).toBe("s");
  });

  it("ranks tables when no sibling exists", () => {
    const fndds = donor({ id: "n", source: "usda_fndds" });
    const foundation = donor({ id: "f", source: "usda_foundation" });
    expect(pickDonor(gap, byConcept([fndds, foundation]))?.id).toBe("f");
  });

  it("refuses a same-concept donor of a different state", () => {
    const pickled = donor({ id: "p", calories: 120 });
    expect(pickDonor({ ...gap, calories: 300 }, byConcept([pickled]))).toBe(
      null,
    );
  });

  it("needs a concept", () => {
    expect(
      pickDonor({ ...gap, conceptName: null }, byConcept([donor({})])),
    ).toBe(null);
  });
});

describe("offeredPortions", () => {
  it("drops metric measures the logging screen never offers", () => {
    expect(
      offeredPortions([
        { label: "100ml", grams: 63 },
        { label: "85g", grams: 85 },
        { label: "1 leaf", grams: 15 },
      ]),
    ).toEqual([{ label: "1 leaf", grams: 15 }]);
  });
});
