import { describe, expect, test } from "bun:test";

import {
  generateApiKey,
  getApiKeyPrefix,
  hashApiKey,
  readApiKeyFromRequest,
} from "./keys";

describe("API key helpers", () => {
  test("generates prefixed high-entropy keys and stores stable hashes", () => {
    const key = generateApiKey();

    expect(key.startsWith("dnut_")).toBe(true);
    expect(key.length).toBeGreaterThan(40);
    expect(getApiKeyPrefix(key)).toBe(key.slice(0, 16));
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toBe(key);
  });

  test("reads explicit or bearer API key headers", () => {
    expect(
      readApiKeyFromRequest(
        new Request("http://localhost", {
          headers: { "x-api-key": "explicit-key" },
        }),
      ),
    ).toBe("explicit-key");

    expect(
      readApiKeyFromRequest(
        new Request("http://localhost", {
          headers: { authorization: "Bearer bearer-key" },
        }),
      ),
    ).toBe("bearer-key");
  });
});
