import { describe, expect, test } from "bun:test";

import { fold, wordsPrefixMatch } from "./fold";

describe("fold", () => {
  test("matches the database's stream_fold", () => {
    expect(fold("Amélie & Œdipe: São Paulo!")).toBe(
      "amelie and oedipe sao paulo",
    );
    expect(fold("Spider-Man: Across the Spider-Verse")).toBe(
      "spider man across the spider verse",
    );
    expect(fold("  Łódź  Straße ")).toBe("lodz strasse");
  });

  test("people match on word prefixes in any order", () => {
    expect(wordsPrefixMatch("hanks tom", "Tom Hanks")).toBe(true);
    expect(wordsPrefixMatch("chris nol", "Christopher Nolan")).toBe(true);
    expect(wordsPrefixMatch("tom", "Anthony Hopkins")).toBe(false);
    expect(wordsPrefixMatch("penelope", "Penélope Cruz")).toBe(true);
  });
});
