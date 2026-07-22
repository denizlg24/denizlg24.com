import { describe, expect, it } from "bun:test";
import { prepareTauriFetchInit } from "./platform";

describe("prepareTauriFetchInit", () => {
  it("keeps request options while withholding AbortSignal from plugin-http", () => {
    const controller = new AbortController();
    const prepared = prepareTauriFetchInit({
      method: "POST",
      body: "payload",
      signal: controller.signal,
    });
    expect(prepared?.method).toBe("POST");
    expect(prepared?.body).toBe("payload");
    expect(prepared?.signal).toBeUndefined();
  });
});
