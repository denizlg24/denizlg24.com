import { describe, expect, it } from "bun:test";

import { screenSharedFoodText } from "./content-filter";

describe("screenSharedFoodText", () => {
  it.each([
    ["Greek Yogurt 0% Fat", "Fage"],
    ["Coca-Cola Zero 330 ml", null],
    ["Scunthorpe Pork Pie", "Classic Bakery"],
    ["Peanut Butter Cups", "Reese's"],
    ["Cocktail Sausages", null],
    ["Pão de Queijo", "Forno de Minas"],
    ["Skyr 1.4 kg", "Arla"],
  ])("lets %s through", (name, brand) => {
    expect(screenSharedFoodText(name, brand)).toEqual({ ok: true });
  });

  it.each([
    ["Fuck this bar"],
    ["F.U.C.K granola"],
    ["Sh1t cookies"],
    ["fuuuuck"],
    ["a$$hole crisps"],
    ["Porra de bolachas"],
    ["MERDA"],
  ])("refuses %s as language", (name) => {
    expect(screenSharedFoodText(name)).toEqual({
      ok: false,
      reason: "language",
    });
  });

  it("refuses links and contact details", () => {
    expect(
      screenSharedFoodText("Protein bar", "buy at cheapbars.shop"),
    ).toEqual({ ok: false, reason: "link" });
    expect(screenSharedFoodText("Bar www.example.com")).toEqual({
      ok: false,
      reason: "link",
    });
    expect(screenSharedFoodText("Call me 912 345 678")).toEqual({
      ok: false,
      reason: "contact",
    });
    expect(screenSharedFoodText("bar", "me@example.com")).toEqual({
      ok: false,
      reason: "contact",
    });
  });
});
