import { describe, expect, it } from "bun:test";

import * as cloudCore from "./index";

describe("@repo/cloud-core", () => {
  it("loads the module", () => {
    expect(cloudCore).toBeDefined();
  });
});
