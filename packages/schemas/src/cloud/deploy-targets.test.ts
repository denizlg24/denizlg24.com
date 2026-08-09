import { describe, expect, it } from "bun:test";

import { updateDeployTargetInputSchema } from "./deploy";

describe("updateDeployTargetInputSchema", () => {
  it("allows a deployment name to be changed", () => {
    expect(
      updateDeployTargetInputSchema.parse({ name: "email-classifier" }),
    ).toEqual({ name: "email-classifier" });
  });

  it("keeps deployment names safe for checks and labels", () => {
    expect(
      updateDeployTargetInputSchema.safeParse({ name: "Email App" }).success,
    ).toBe(false);
  });
});
