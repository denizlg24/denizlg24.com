import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseNutritionLabel, VisionServiceError } from "./vision-client";

const originalFetch = globalThis.fetch;

function installFetchMock(
  implementation: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  globalThis.fetch = Object.assign(mock(implementation), {
    preconnect: originalFetch.preconnect,
  });
}

const emptyLabel = {
  version: "v1",
  basis: "unknown",
  servingQuantity: null,
  servingUnit: null,
  servingsPerContainer: null,
  fields: {},
  rawText: "",
  warnings: [],
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MACROS_LABEL_SERVICE_URL;
  delete process.env.MACROS_LABEL_SERVICE_TOKEN;
});

describe("label client", () => {
  test("validates the shared response contract", async () => {
    process.env.MACROS_LABEL_SERVICE_TOKEN = "secret";
    installFetchMock(async () =>
      Response.json({
        ...emptyLabel,
        basis: "per_100g",
        servingQuantity: 100,
        servingUnit: "g",
        fields: { calories: { value: 200, unit: "kcal", confidence: 0.9 } },
      }),
    );
    const result = await parseNutritionLabel(new Blob(["image"]));
    expect(result.fields.calories?.value).toBe(200);
  });

  test("posts the image and format to the label route with the secret", async () => {
    process.env.MACROS_LABEL_SERVICE_URL = "http://web:3000/";
    process.env.MACROS_LABEL_SERVICE_TOKEN = "secret";
    let url = "";
    let authorization: string | null = null;
    let postedFormat: FormDataEntryValue | null = null;
    installFetchMock(async (input, init) => {
      url = String(input);
      authorization = new Headers(init?.headers).get("authorization");
      if (init?.body instanceof FormData) {
        postedFormat = init.body.get("labelFormat");
      }
      return Response.json(emptyLabel);
    });

    await parseNutritionLabel(new Blob(["image"]), "eu");
    expect(url).toBe("http://web:3000/api/services/macros/nutrition-label");
    expect(String(authorization)).toBe("Bearer secret");
    expect(String(postedFormat)).toBe("eu");
  });

  test("does not retry a failed read", async () => {
    process.env.MACROS_LABEL_SERVICE_TOKEN = "secret";
    let calls = 0;
    installFetchMock(async () => {
      calls += 1;
      return new Response(null, { status: 502 });
    });
    await expect(parseNutritionLabel(new Blob(["image"]))).rejects.toThrow(
      VisionServiceError,
    );
    expect(calls).toBe(1);
  });

  test("never passes a refused credential through as the caller's 401", async () => {
    process.env.MACROS_LABEL_SERVICE_TOKEN = "wrong";
    installFetchMock(async () => new Response(null, { status: 401 }));
    const error = await parseNutritionLabel(new Blob(["image"])).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(VisionServiceError);
    expect(error instanceof VisionServiceError ? error.status : 0).toBeNull();
  });

  test("fails clearly when it is not configured", async () => {
    expect(parseNutritionLabel(new Blob(["image"]))).rejects.toBeInstanceOf(
      VisionServiceError,
    );
  });
});
