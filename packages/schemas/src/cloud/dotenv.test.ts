import { describe, expect, it } from "bun:test";

import { parseDotenv } from "./dotenv";

const values = (input: string): Record<string, string> =>
  Object.fromEntries(
    parseDotenv(input).entries.map((entry) => [entry.key, entry.value]),
  );

describe("parseDotenv", () => {
  it("reads bare, exported, quoted and empty assignments", () => {
    expect(
      values(
        [
          "PLAIN=one",
          "export EXPORTED=two",
          'DOUBLE="three four"',
          "SINGLE='five six'",
          "EMPTY=",
          "SPACED  =  seven  ",
        ].join("\n"),
      ),
    ).toEqual({
      PLAIN: "one",
      EXPORTED: "two",
      DOUBLE: "three four",
      SINGLE: "five six",
      EMPTY: "",
      SPACED: "seven",
    });
  });

  it("ignores comment lines and trailing comments", () => {
    expect(
      values(
        ["# a leading comment", "KEY=value # trailing", "  # indented"].join(
          "\n",
        ),
      ),
    ).toEqual({ KEY: "value" });
  });

  it("keeps a hash that is part of the value", () => {
    expect(values("URL=https://example.com/page#section")).toEqual({
      URL: "https://example.com/page#section",
    });
    expect(values("PASSWORD=abc#def")).toEqual({ PASSWORD: "abc#def" });
  });

  it("does not treat a hash inside quotes as a comment", () => {
    expect(values('SECRET="p#ss word" # real comment')).toEqual({
      SECRET: "p#ss word",
    });
  });

  it("reads a value that spans lines inside quotes", () => {
    const parsed = parseDotenv(
      ['PRIVATE_KEY="line one', "line two", 'line three"', "AFTER=yes"].join(
        "\n",
      ),
    );

    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]?.value).toBe("line one\nline two\nline three");
    expect(parsed.entries[1]?.key).toBe("AFTER");
  });

  it("expands escapes in double quotes but not single", () => {
    expect(values('KEY="a\\nb\\tc"')).toEqual({ KEY: "a\nb\tc" });
    expect(values("KEY='a\\nb'")).toEqual({ KEY: "a\\nb" });
    expect(values('KEY="say \\"hi\\""')).toEqual({ KEY: 'say "hi"' });
  });

  it("leaves $VAR references alone", () => {
    expect(values("A=one\nB=$A/two")).toEqual({ A: "one", B: "$A/two" });
  });

  it("keeps the last of a duplicated key and reports it", () => {
    const parsed = parseDotenv("KEY=first\nKEY=second");

    expect(parsed.entries).toEqual([{ key: "KEY", value: "second", line: 2 }]);
    expect(parsed.duplicateKeys).toEqual(["KEY"]);
  });

  it("separates invalid names from unreadable lines", () => {
    const parsed = parseDotenv(
      ["9LEADING=digit", "with-dash=nope", "just some prose", "GOOD=yes"].join(
        "\n",
      ),
    );

    expect(parsed.entries.map((entry) => entry.key)).toEqual(["GOOD"]);
    expect(parsed.invalidKeys.map((entry) => entry.key)).toEqual([
      "9LEADING",
      "with-dash",
    ]);
    expect(parsed.skippedLines).toEqual([3]);
  });

  it("reports an unterminated quote instead of swallowing the rest of the file", () => {
    const parsed = parseDotenv('BROKEN="never closed\nNEXT=value');

    expect(parsed.entries).toEqual([]);
    expect(parsed.skippedLines).toEqual([1]);
  });

  it("handles CRLF input", () => {
    expect(values("A=one\r\nB=two\r\n")).toEqual({ A: "one", B: "two" });
  });

  it("returns nothing for an empty or comment-only paste", () => {
    expect(parseDotenv("").entries).toEqual([]);
    expect(parseDotenv("\n\n# nothing here\n").entries).toEqual([]);
  });
});
