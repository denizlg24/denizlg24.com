import { describe, expect, test } from "bun:test";
import { redactText, redactValue } from "./redact";

describe("redactText", () => {
  test.each([
    ["mail me at joao.silva+sw@gmail.com", "mail me at [email]"],
    ["IBAN PT50 0002 0123 1234 5678 9015 4 please", "IBAN [iban] please"],
    ["card 4242 4242 4242 4242", "card [card]"],
    ["call +351 912 345 678 later", "call [phone] later"],
    ["call (415) 555-0134", "call [phone]"],
    ["account U1234567 at IBKR", "account [account] at IBKR"],
    ["my flex token is 123456789012345678901234", "my flex token is [secret]"],
    ["Query ID: 987654", "Query ID: [secret]"],
    ["key sk-abcdefghijklmnopqrstuvwx", "key [secret]"],
    ["bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw", "bot [secret]"],
    ["I live at 221 Baker Street", "I live at [address]"],
    ["Rua Augusta, 120, 1100-053 Lisboa", "[address], [postcode] Lisboa"],
  ])("%s", (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  test("keeps market text intact", () => {
    const text =
      "AAPL closed at $227.48, up 1.2% on 52,310,000 shares; P/E 34.1, 2025 revenue $391bn.";
    expect(redactText(text)).toBe(text);
  });

  test("redacts the subject's own name and email local part", () => {
    expect(
      redactText("Hi, I'm Maria Lopes (mlopes), Maria here", {
        name: "Maria Lopes",
        email: "mlopes@example.com",
      }),
    ).toBe("Hi, I'm [name] [name] ([name]), [name] here");
  });

  test("is idempotent", () => {
    const once = redactText("a@b.co +351 912 345 678 U1234567");
    expect(redactText(once)).toBe(once);
  });
});

test("redactValue walks objects and arrays, leaving keys and numbers", () => {
  expect(
    redactValue({
      email: "x@y.io",
      list: ["U7654321", 42],
      nested: { price: 101.5, note: "ping +44 20 7946 0958" },
    }),
  ).toEqual({
    email: "[email]",
    list: ["[account]", 42],
    nested: { price: 101.5, note: "ping [phone]" },
  });
});
