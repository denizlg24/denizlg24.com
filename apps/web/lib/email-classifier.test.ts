import { afterEach, describe, expect, mock, test } from "bun:test";
import { classifyEmail, EmailClassifierError } from "./email-classifier";

const realFetch = globalThis.fetch;
const originalUrl = process.env.EMAIL_CLASSIFIER_URL;
const originalToken = process.env.EMAIL_CLASSIFIER_API_TOKEN;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (originalUrl === undefined) delete process.env.EMAIL_CLASSIFIER_URL;
  else process.env.EMAIL_CLASSIFIER_URL = originalUrl;
  if (originalToken === undefined)
    delete process.env.EMAIL_CLASSIFIER_API_TOKEN;
  else process.env.EMAIL_CLASSIFIER_API_TOKEN = originalToken;
});

describe("classifyEmail", () => {
  test("sends the complete body and parses the probability response", async () => {
    process.env.EMAIL_CLASSIFIER_URL =
      "https://classifier.denizlg24.com/api/classify";
    process.env.EMAIL_CLASSIFIER_API_TOKEN = "test-token";
    const body = "complete email body\n".repeat(2_000);
    const fetchMock = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.cache).toBe("no-store");
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer test-token",
        });
        const request = JSON.parse(String(init?.body));
        expect(request.body).toBe(body);

        return Response.json({
          category: "purchases",
          confidence: 0.91,
          probabilities: {
            spam: 0.01,
            newsletter: 0.01,
            promo: 0.02,
            purchases: 0.91,
            fyi: 0.02,
            "action-needed": 0.02,
            scheduled: 0.01,
          },
          model_version: "logistic-regression-v1",
        });
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await classifyEmail({
      subject: "Receipt",
      body,
      senderName: "Store",
      senderAddress: "billing@example.com",
      attachmentCount: 1,
      hasHtml: false,
    });

    expect(result).toMatchObject({
      category: "purchases",
      confidence: 0.91,
      modelVersion: "logistic-regression-v1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("rejects incomplete classifier output", async () => {
    process.env.EMAIL_CLASSIFIER_URL =
      "https://classifier.denizlg24.com/api/classify";
    process.env.EMAIL_CLASSIFIER_API_TOKEN = "test-token";
    globalThis.fetch = mock(async () =>
      Response.json({
        category: "fyi",
        confidence: 0.8,
        probabilities: {},
        model_version: "v1",
      }),
    ) as unknown as typeof fetch;

    await expect(
      classifyEmail({
        subject: "",
        body: "",
        senderName: "",
        senderAddress: "",
        attachmentCount: 0,
        hasHtml: false,
      }),
    ).rejects.toBeInstanceOf(EmailClassifierError);
  });

  test("requires server-side URL and token configuration", async () => {
    delete process.env.EMAIL_CLASSIFIER_URL;
    delete process.env.EMAIL_CLASSIFIER_API_TOKEN;

    await expect(
      classifyEmail({
        subject: "",
        body: "",
        senderName: "",
        senderAddress: "",
        attachmentCount: 0,
        hasHtml: false,
      }),
    ).rejects.toThrow("must be configured");
  });
});
