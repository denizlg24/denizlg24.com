import { expect, test } from "bun:test";
import { isQuotaExceeded } from "./quota";

test("finds the gateway's budget refusal wherever the SDK put it", () => {
  const body = JSON.stringify({
    error: {
      message: "API key budget exceeded.",
      type: "quota_for_entity_exceeded",
    },
  });
  expect(isQuotaExceeded({ responseBody: body })).toBe(true);
  expect(
    isQuotaExceeded(
      new Error("wrapped", { cause: { type: "quota_for_entity_exceeded" } }),
    ),
  ).toBe(true);
  expect(isQuotaExceeded("402 quota_for_entity_exceeded")).toBe(true);
});

test("leaves other failures alone", () => {
  expect(isQuotaExceeded(new Error("insufficient_funds"))).toBe(false);
  expect(isQuotaExceeded(undefined)).toBe(false);
  const loop: { cause?: unknown; message: string } = { message: "x" };
  loop.cause = loop;
  expect(isQuotaExceeded(loop)).toBe(false);
});
