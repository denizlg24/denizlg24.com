import { beforeEach, describe, expect, mock, test } from "bun:test";

const getAdminSessionMock = mock(
  async (): Promise<unknown> => ({
    user: { email: "admin@example.com", role: "admin", emailVerified: true },
  }),
);
const checkRateLimitMock = mock(async () => ({
  allowed: true,
  remaining: 19,
  resetMs: 60_000,
}));
const connectDBMock = mock(async () => {});
const accountLeanMock = mock(async (): Promise<unknown> => null);
const findByIdMock = mock(() => ({ lean: accountLeanMock }));
const sendMailFromAccountMock = mock(
  async (_account: unknown, _input: unknown) => ({}),
);

mock.module("@/lib/require-admin", () => ({
  getAdminSession: getAdminSessionMock,
  requireAdmin: mock(async () => null),
}));
mock.module("@/lib/rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
}));
mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/lib/smtp", () => ({
  isSmtpConfigured: (account: { smtpHost?: string }) =>
    Boolean(account.smtpHost),
  SMTP_PROVIDER_DEFAULTS: {
    gmail: {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      requireTLS: false,
    },
    outlook: {
      host: "smtp-mail.outlook.com",
      port: 587,
      secure: false,
      requireTLS: true,
    },
    yahoo: {
      host: "smtp.mail.yahoo.com",
      port: 465,
      secure: true,
      requireTLS: false,
    },
    icloud: {
      host: "smtp.mail.me.com",
      port: 587,
      secure: false,
      requireTLS: true,
    },
  },
  sendMailFromAccount: sendMailFromAccountMock,
  verifySmtpConnection: mock(async () => {}),
}));
mock.module("@/models/EmailAccount", () => ({
  EmailAccountModel: {
    create: mock(async () => ({})),
    find: mock(() => ({ lean: mock(async () => []) })),
    findById: findByIdMock,
    findByIdAndUpdate: mock(async () => ({})),
    findOne: mock(async () => null),
  },
}));

const { POST } = await import("./route");

function sendRequest(body: unknown) {
  return new Request(
    "http://localhost/api/admin/email-accounts/account-id/send",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  ) as Parameters<typeof POST>[0];
}

const params = { params: Promise.resolve({ id: "account-id" }) };

beforeEach(() => {
  getAdminSessionMock.mockReset();
  getAdminSessionMock.mockResolvedValue({
    user: { email: "admin@example.com", role: "admin", emailVerified: true },
  });
  checkRateLimitMock.mockReset();
  checkRateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 19,
    resetMs: 60_000,
  });
  connectDBMock.mockClear();
  accountLeanMock.mockReset();
  accountLeanMock.mockResolvedValue({
    _id: "account-id",
    provider: "gmail",
    user: "sender@example.com",
    smtpHost: "smtp.gmail.com",
  });
  findByIdMock.mockClear();
  sendMailFromAccountMock.mockReset();
  sendMailFromAccountMock.mockResolvedValue({});
});

describe("POST /api/admin/email-accounts/[id]/send", () => {
  test("requires admin auth", async () => {
    getAdminSessionMock.mockResolvedValue(null);

    const response = await POST(
      sendRequest({
        to: ["to@example.com"],
        subject: "Hi",
        text: "Hello",
      }),
      params,
    );

    expect(response.status).toBe(401);
    expect(sendMailFromAccountMock).not.toHaveBeenCalled();
  });

  test("sends valid email requests", async () => {
    const response = await POST(
      sendRequest({
        to: ["to@example.com"],
        subject: "Hi",
        text: "Hello",
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(sendMailFromAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "account-id" }),
      expect.objectContaining({
        to: ["to@example.com"],
        subject: "Hi",
        text: "Hello",
      }),
    );
  });

  test("sends multipart requests with attachments", async () => {
    const formData = new FormData();
    formData.set("to", JSON.stringify(["to@example.com"]));
    formData.set("subject", "Hi");
    formData.set("text", "Hello");
    formData.append(
      "attachments",
      new File(["attachment body"], "notes.txt", { type: "text/plain" }),
    );

    const response = await POST(
      new Request("http://localhost/api/admin/email-accounts/account-id/send", {
        method: "POST",
        body: formData,
      }) as Parameters<typeof POST>[0],
      params,
    );

    expect(response.status).toBe(200);
    expect(sendMailFromAccountMock).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "account-id" }),
      expect.objectContaining({
        to: ["to@example.com"],
        subject: "Hi",
        text: "Hello",
        attachments: [
          expect.objectContaining({
            filename: "notes.txt",
            contentType: expect.stringContaining("text/plain"),
            content: Buffer.from("attachment body"),
          }),
        ],
      }),
    );
  });

  test("rejects oversized multipart attachments before sending", async () => {
    const formData = new FormData();
    formData.set("to", JSON.stringify(["to@example.com"]));
    formData.set("subject", "Hi");
    formData.set("text", "Hello");
    formData.append(
      "attachments",
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.bin"),
    );

    const response = await POST(
      new Request("http://localhost/api/admin/email-accounts/account-id/send", {
        method: "POST",
        body: formData,
      }) as Parameters<typeof POST>[0],
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Attachment is too large");
    expect(sendMailFromAccountMock).not.toHaveBeenCalled();
  });

  test("rejects invalid recipients before sending", async () => {
    const response = await POST(
      sendRequest({
        to: ["not-an-email"],
        subject: "Hi",
        text: "Hello",
      }),
      params,
    );

    expect(response.status).toBe(400);
    expect(sendMailFromAccountMock).not.toHaveBeenCalled();
  });

  test("rejects accounts without SMTP configured", async () => {
    sendMailFromAccountMock.mockRejectedValue(
      new Error("SMTP is not configured for this account"),
    );

    const response = await POST(
      sendRequest({
        to: ["to@example.com"],
        subject: "Hi",
        text: "Hello",
      }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("SMTP sending is not configured");
  });

  test("returns generic error on SMTP failure", async () => {
    sendMailFromAccountMock.mockRejectedValue(new Error("535 password secret"));

    const response = await POST(
      sendRequest({
        to: ["to@example.com"],
        subject: "Hi",
        text: "Hello",
      }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe(
      "Failed to send email. Check the account SMTP settings.",
    );
    expect(body.error).not.toContain("password secret");
  });
});
