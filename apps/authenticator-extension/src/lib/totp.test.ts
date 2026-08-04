import { describe, expect, test } from "bun:test";
import { parseOtpAuthUri, splitUriList } from "./otpauth-uri";
import { formatCode, generateCode } from "./totp";

/** RFC 6238 Appendix B: seed "12345678901234567890" as base32. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("generateCode", () => {
  test.each([
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
  ])("matches the RFC 6238 vector at t=%i", (seconds, expected) => {
    const result = generateCode(
      { secret: RFC_SECRET, algorithm: "SHA1", digits: 8, period: 30 },
      seconds * 1000,
    );
    expect(result.code).toBe(expected);
  });

  test("counts down within the step", () => {
    const params = {
      secret: RFC_SECRET,
      algorithm: "SHA1" as const,
      digits: 6,
      period: 30,
    };
    expect(generateCode(params, 0).remaining).toBe(30);
    expect(generateCode(params, 29_000).remaining).toBe(1);
    expect(generateCode(params, 30_000).remaining).toBe(30);
  });

  test("rejects a secret that is not base32", () => {
    expect(() =>
      generateCode(
        { secret: "not base32!", algorithm: "SHA1", digits: 6, period: 30 },
        0,
      ),
    ).toThrow();
  });
});

describe("formatCode", () => {
  test("splits six and eight digit codes down the middle", () => {
    expect(formatCode("123456")).toBe("123 456");
    expect(formatCode("12345678")).toBe("1234 5678");
  });
});

describe("parseOtpAuthUri", () => {
  test("reads issuer, account and parameters", () => {
    const parsed = parseOtpAuthUri(
      `otpauth://totp/GitHub:deniz@example.com?secret=${RFC_SECRET}&issuer=GitHub&algorithm=SHA256&digits=8&period=60`,
    );

    expect(parsed).toEqual({
      label: "GitHub",
      issuer: "GitHub",
      accountName: "deniz@example.com",
      secret: RFC_SECRET,
      algorithm: "SHA256",
      digits: 8,
      period: 60,
    });
  });

  test("falls back to defaults when parameters are omitted", () => {
    const parsed = parseOtpAuthUri(
      `otpauth://totp/deniz@example.com?secret=${RFC_SECRET}`,
    );

    expect(parsed.label).toBe("deniz@example.com");
    expect(parsed.issuer).toBe("");
    expect(parsed.algorithm).toBe("SHA1");
    expect(parsed.digits).toBe(6);
    expect(parsed.period).toBe(30);
  });

  test("refuses HOTP", () => {
    expect(() =>
      parseOtpAuthUri(`otpauth://hotp/Example?secret=${RFC_SECRET}&counter=1`),
    ).toThrow();
  });
});

describe("splitUriList", () => {
  test("drops blank lines and surrounding whitespace", () => {
    expect(splitUriList("  a\n\n b \n")).toEqual(["a", "b"]);
  });
});
