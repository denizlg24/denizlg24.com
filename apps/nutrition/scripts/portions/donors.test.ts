import { describe, expect, it } from "bun:test";
import { type Donor, offeredPortions, pickDonor } from "./donors";

const donor = (overrides: Partial<Donor>): Donor => ({
  id: "donor",
  name: "Cabbage, raw",
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
  name: "Cabbage, raw",
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

  it("does not borrow Asian pear sizes for European pears", () => {
    const asian = donor({
      name: "Pear, Asian, raw",
      conceptName: "pear, raw",
      calories: 42,
    });
    const european = donor({
      id: "e",
      name: "Pears, raw",
      conceptName: "pear, raw",
      calories: 57,
    });
    const pear = {
      ...gap,
      name: "Pear, William Bartlett, unpeeled, raw",
      conceptName: "pear, raw",
      calories: 45,
    };
    expect(pickDonor(pear, byConcept([asian, european]))?.id).toBe("e");
    expect(pickDonor(pear, byConcept([asian]))).toBeNull();
  });

  it("prefers useful sizes over a sibling with only one measure", () => {
    const sparse = donor({ id: "s", clusterKey: "c:1" });
    const complete = donor({
      id: "f",
      portions: [
        { label: "1 small", grams: 500 },
        { label: "1 medium", grams: 900 },
        { label: "1 large", grams: 1200 },
      ],
    });
    expect(
      pickDonor({ ...gap, clusterKey: "c:1" }, byConcept([sparse, complete]))
        ?.id,
    ).toBe("f");
  });

  it("needs a concept", () => {
    expect(
      pickDonor({ ...gap, conceptName: null }, byConcept([donor({})])),
    ).toBe(null);
  });
});

describe("offeredPortions", () => {
  it("deduplicates labels beyond the display limit", () => {
    const portions = Array.from({ length: 9 }, (_, index) => ({
      label: `1 measure ${index}`,
      grams: index + 1,
    }));
    expect(
      offeredPortions([...portions, { label: "1 MEASURE 8", grams: 90 }]),
    ).toEqual(portions);
  });

  it("adds new labels from an equally sized donor while keeping existing weights", () => {
    const existing = [
      { label: "1 cup", grams: 150 },
      { label: "1 piece", grams: 50 },
    ];
    const donor = [
      { label: "1 cup", grams: 160 },
      { label: "1 fruit", grams: 66 },
    ];
    expect(
      offeredPortions([...existing, ...donor]).slice(existing.length),
    ).toEqual([{ label: "1 fruit", grams: 66 }]);
  });
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
