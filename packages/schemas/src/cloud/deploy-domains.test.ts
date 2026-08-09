import { describe, expect, test } from "bun:test";

import { updateDeployDomainInputSchema } from "./deploy";

describe("updateDeployDomainInputSchema", () => {
  test("accepts a primary or redirect update independently", () => {
    expect(updateDeployDomainInputSchema.parse({ isPrimary: true })).toEqual({
      isPrimary: true,
    });
    expect(
      updateDeployDomainInputSchema.parse({ redirectTo: "example.com" }),
    ).toEqual({ redirectTo: "example.com" });
  });

  test("rejects primary and redirect instructions in the same update", () => {
    expect(
      updateDeployDomainInputSchema.safeParse({
        isPrimary: true,
        redirectTo: "example.com",
      }).success,
    ).toBe(false);
  });
});
