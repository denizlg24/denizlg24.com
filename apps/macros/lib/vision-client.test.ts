import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseNutritionLabel, VisionServiceError } from "./vision-client";

const originalFetch = globalThis.fetch;

function installFetchMock(implementation: () => Promise<Response>) {
  globalThis.fetch = Object.assign(mock(implementation), {
    preconnect: originalFetch.preconnect,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MACROS_VISION_URL;
  delete process.env.MACROS_VISION_API_TOKEN;
});

describe("vision client", () => {
  test("validates the shared response contract", async () => {
    process.env.MACROS_VISION_URL = "http://vision:8090/";
    process.env.MACROS_VISION_API_TOKEN = "secret";
    installFetchMock(async () =>
      Response.json({
        version: "v1",
        basis: "per_100g",
        servingQuantity: 100,
        servingUnit: "g",
        servingsPerContainer: null,
        fields: { calories: { value: 200, unit: "kcal", confidence: 0.9 } },
        rawText: "Energy 200 kcal",
        warnings: [],
      }),
    );
    const result = await parseNutritionLabel(new Blob(["image"]));
    expect(result.fields.calories?.value).toBe(200);
  });

  test("retries one transient service failure", async () => {
    process.env.MACROS_VISION_URL = "http://vision:8090";
    process.env.MACROS_VISION_API_TOKEN = "secret";
    let calls = 0;
    installFetchMock(async () => {
      calls += 1;
      return calls === 1
        ? new Response(null, { status: 503 })
        : Response.json({
            version: "v1",
            basis: "unknown",
            servingQuantity: null,
            servingUnit: null,
            servingsPerContainer: null,
            fields: {},
            rawText: "",
            warnings: ["No label found"],
          });
    });
    await parseNutritionLabel(new Blob(["image"]));
    expect(calls).toBe(2);
  });

  test("fails clearly when it is not configured", async () => {
    expect(parseNutritionLabel(new Blob(["image"]))).rejects.toBeInstanceOf(
      VisionServiceError,
    );
  });
});
