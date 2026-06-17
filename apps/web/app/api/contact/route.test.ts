import { beforeEach, describe, expect, mock, test } from "bun:test";

const checkRateLimitMock = mock(async () => ({ allowed: true, resetMs: 0 }));
const createContactMock = mock(async () => ({ ticketId: "TICKET-123" }));
const sendContactConfirmationMock = mock(async () => ({ success: true }));
const ipAddressMock = mock(() => "1.2.3.4");

mock.module("@vercel/functions", () => ({ ipAddress: ipAddressMock }));
mock.module("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
mock.module("@/lib/contacts", () => ({ createContact: createContactMock }));
mock.module("@/lib/resend", () => ({
  sendContactConfirmation: sendContactConfirmationMock,
}));

const { POST } = await import("./route");

function buildRequest(body: unknown): Parameters<typeof POST>[0] {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as Parameters<typeof POST>[0];
}

const validBody = {
  name: "Jane Doe",
  email: "jane@example.com",
  message: "This is a sufficiently long contact message.",
};

beforeEach(() => {
  checkRateLimitMock.mockReset();
  checkRateLimitMock.mockResolvedValue({ allowed: true, resetMs: 0 });
  createContactMock.mockReset();
  createContactMock.mockResolvedValue({ ticketId: "TICKET-123" });
  sendContactConfirmationMock.mockReset();
  sendContactConfirmationMock.mockResolvedValue({ success: true });
  ipAddressMock.mockReset();
  ipAddressMock.mockReturnValue("1.2.3.4");
});

describe("POST /api/contact", () => {
  test("happy path returns 201 with ticket and emailSent", async () => {
    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      success: true,
      message: "Contact form submitted successfully",
      ticketId: "TICKET-123",
      emailSent: true,
    });
    expect(createContactMock).toHaveBeenCalledTimes(1);
  });

  test("rate limited returns 429 with Retry-After and skips createContact", async () => {
    checkRateLimitMock.mockResolvedValue({
      allowed: false,
      resetMs: 3_600_000,
    });

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(createContactMock).not.toHaveBeenCalled();
  });

  test("invalid body returns 400 and skips createContact", async () => {
    const response = await POST(
      buildRequest({ name: "Jane Doe", message: "too short" }),
    );

    expect(response.status).toBe(400);
    expect(createContactMock).not.toHaveBeenCalled();
  });

  test("downstream failure returns 500", async () => {
    createContactMock.mockRejectedValue(new Error("db down"));

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(500);
  });

  test("emailSent reflects a failed confirmation send", async () => {
    sendContactConfirmationMock.mockResolvedValue({ success: false });

    const response = await POST(buildRequest(validBody));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      success: true,
      emailSent: false,
    });
  });
});
