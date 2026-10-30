import { describe, expect, test } from "bun:test";
import { householdServings } from "./portions";
import { buildServingOptions, foodServingFrom } from "./serving-options";

describe("householdServings", () => {
  test("keeps household measures per one unit and drops metric ones", () => {
    expect(
      householdServings([
        { label: "100ml mashed", grams: 95.1 },
        { label: "0.5 cup, shredded", grams: 35 },
        { label: '1 head, large (about 7" dia)', grams: 1248 },
        { label: "1 head, medium (14.5cm  dia)", grams: 908 },
        { label: "85g", grams: 85 },
        { label: "3 oz", grams: 85 },
        { label: "1 fl oz (no ice)", grams: 30 },
        { label: "1 cubic inch", grams: 17 },
      ]),
    ).toEqual([
      { label: "cup, shredded", grams: 70 },
      { label: "head, large", grams: 1248 },
      { label: "head, medium", grams: 908 },
    ]);
  });

  test("keeps sizes without a number and expands abbreviations", () => {
    expect(
      householdServings([
        { label: "pcs (medium)", grams: 125 },
        { label: "pcs (small)", grams: 90 },
        { label: "1 small (15cm to 17.5cm long)", grams: 101 },
        { label: "1/2 tbsp", grams: 7 },
      ]),
    ).toEqual([
      { label: "piece (medium)", grams: 125 },
      { label: "piece (small)", grams: 90 },
      { label: "small", grams: 101 },
      { label: "tablespoon", grams: 14 },
    ]);
  });

  test("keeps both Asian pear sizes when dimensions distinguish them", () => {
    expect(
      householdServings([
        { label: "1 fruit (8.5 cm x 7.6 cm dia)", grams: 275 },
        { label: "1 fruit (5.7cm x 6.4cm dia)", grams: 122 },
      ]),
    ).toEqual([
      { label: "fruit (8.5 cm x 7.6 cm dia)", grams: 275 },
      { label: "fruit (5.7cm x 6.4cm dia)", grams: 122 },
    ]);
  });

  test("collapses duplicates once dimensions are trimmed", () => {
    expect(
      householdServings([
        { label: '1 head, large (about 7" dia)', grams: 1248 },
        { label: "1 head, large (18cm dia)", grams: 1250 },
      ]),
    ).toEqual([{ label: "head, large", grams: 1248 }]);
  });
});

describe("portions in serving options", () => {
  test("a per-100 g food offers its household measures in grams", () => {
    const options = buildServingOptions(
      foodServingFrom({
        itemId: "00000000-0000-4000-8000-000000000000",
        servingLabel: "100 g",
        servingQuantity: 100,
        servingUnit: "g",
        nutrients: {},
        portions: [
          { label: '1 head, large (about 7" dia)', grams: 1248 },
          { label: "1 leaf", grams: 15 },
        ],
      }),
    );
    const head = options.options.find((option) =>
      option.title.startsWith("head, large"),
    );
    expect(head?.title).toBe("head, large • 1248 g");
    expect(head?.servingsPerUnit).toBeCloseTo(12.48);
    expect(head?.enteredUnit).toBe("g");
    expect(head?.enteredPerUnit).toBe(1248);
    expect(options.defaultId).toBe("g");
  });
});

describe("householdServings noise", () => {
  test("drops regulatory and yield measures and unclosed sizes", () => {
    expect(
      householdServings([
        { label: "1 RACC", grams: 110 },
        { label: "1 NLEA serving", grams: 151 },
        { label: "1 fruit yields", grams: 86 },
        { label: "Guideline amount per cup of vegetable", grams: 60 },
        { label: '1 potato large (3" to 4-1/4" dia.', grams: 299 },
      ]),
    ).toEqual([{ label: "potato large", grams: 299 }]);
  });
});
