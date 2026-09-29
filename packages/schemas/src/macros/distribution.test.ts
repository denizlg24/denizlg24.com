import { describe, expect, test } from "bun:test";
import {
  macrosCreateDistributionRequestBodySchema,
  macrosUdidSchema,
} from "./distribution";

describe("macrosUdidSchema", () => {
  test("uppercases a modern UDID and trims around it", () => {
    expect(macrosUdidSchema.parse(" 00008030-001a2b3c4d5e6f70 ")).toBe(
      "00008030-001A2B3C4D5E6F70",
    );
  });

  test("restores the hyphen of a modern UDID pasted without it", () => {
    expect(macrosUdidSchema.parse("00008030001A2B3C4D5E6F70")).toBe(
      "00008030-001A2B3C4D5E6F70",
    );
  });

  test("accepts the 40-hex form of older iPhones", () => {
    expect(macrosUdidSchema.parse("a".repeat(40))).toBe("A".repeat(40));
  });

  test.each([
    "",
    "00008030-001A2B3C4D5E6F7",
    "0000803-0001A2B3C4D5E6F70",
    "G0008030-001A2B3C4D5E6F70",
    "a".repeat(39),
    "C02XK0ABJGH5",
  ])("refuses %p", (value) => {
    expect(macrosUdidSchema.safeParse(value).success).toBe(false);
  });
});

describe("macrosCreateDistributionRequestBodySchema", () => {
  test("normalises the email", () => {
    const parsed = macrosCreateDistributionRequestBodySchema.parse({
      name: " Ana ",
      email: " Ana@Example.COM ",
      udid: "00008030-001A2B3C4D5E6F70",
    });
    expect(parsed.name).toBe("Ana");
    expect(parsed.email).toBe("ana@example.com");
  });
});
