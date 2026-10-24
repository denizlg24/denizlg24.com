import { expect, test } from "bun:test";

import { audienceRules, rulesKey } from "@/lib/audience-rules";

const adult = { kids: false, showIndianCinema: false };
const fan = { kids: false, showIndianCinema: true };
const child = { kids: true, showIndianCinema: true };

test("Indian cinema is hidden unless everyone on the sofa turned it on", () => {
  expect(audienceRules([adult]).hideIndianCinema).toBe(true);
  expect(audienceRules([fan]).hideIndianCinema).toBe(false);
  expect(audienceRules([fan, adult]).hideIndianCinema).toBe(true);
  expect(audienceRules([fan, child]).hideIndianCinema).toBe(false);
  expect(audienceRules([]).hideIndianCinema).toBe(true);
});

test("any kids profile keeps the whole sofa kid-safe", () => {
  expect(audienceRules([fan, child]).kids).toBe(true);
  expect(audienceRules([fan, adult]).kids).toBe(false);
});

test("different rules never share a cache key", () => {
  const keys = new Set(
    [[adult], [fan], [child], [adult, child]].map((sofa) =>
      rulesKey(audienceRules(sofa)),
    ),
  );
  expect(keys.size).toBe(4);
});
