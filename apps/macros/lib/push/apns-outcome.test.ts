import { describe, expect, test } from "bun:test";
import { classifyApnsResponse, readApnsReason } from "./apns-outcome";

describe("classifyApnsResponse", () => {
  test("200 is sent", () => {
    expect(classifyApnsResponse(200, null)).toBe("sent");
  });

  test("410 and dead-token reasons disable the device", () => {
    expect(classifyApnsResponse(410, "Unregistered")).toBe("disable");
    expect(classifyApnsResponse(400, "BadDeviceToken")).toBe("disable");
    expect(classifyApnsResponse(400, "DeviceTokenNotForTopic")).toBe("disable");
  });

  test("a refused provider token asks for a new one", () => {
    expect(classifyApnsResponse(403, "ExpiredProviderToken")).toBe(
      "refresh-token",
    );
    expect(classifyApnsResponse(403, "InvalidProviderToken")).toBe(
      "refresh-token",
    );
  });

  test("anything else is a plain failure", () => {
    expect(classifyApnsResponse(400, "PayloadTooLarge")).toBe("failed");
    expect(classifyApnsResponse(429, "TooManyRequests")).toBe("failed");
    expect(classifyApnsResponse(503, null)).toBe("failed");
  });
});

describe("readApnsReason", () => {
  test("reads reason from the error body", () => {
    expect(readApnsReason('{"reason":"BadDeviceToken"}')).toBe(
      "BadDeviceToken",
    );
    expect(readApnsReason("")).toBeNull();
    expect(readApnsReason('{"other":1}')).toBeNull();
  });
});
