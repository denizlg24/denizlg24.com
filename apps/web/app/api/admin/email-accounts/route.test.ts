import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextResponse } from "next/server";

const requireAdminMock = mock(async () => null as NextResponse | null);
const connectDBMock = mock(async () => {});
const mailboxOpenMock = mock(async (_name: string) => {});
const logoutMock = mock(async () => {});
const createImapClientMock = mock(async () => ({
  mailboxOpen: mailboxOpenMock,
  logout: logoutMock,
}));
const verifySmtpConnectionMock = mock(async (_settings: unknown) => {});
const encryptPasswordMock = mock((value: string) => ({
  ciphertext: `encrypted:${value}`,
  iv: "iv",
  authTag: "tag",
}));
const revalidatePathMock = mock((_path: string) => {});
const accountLeanMock = mock(async (): Promise<unknown[]> => []);
const accountFindMock = mock(() => ({ lean: accountLeanMock }));
const accountFindOneMock = mock(async () => null);
function createAccountDocument(data: Record<string, unknown>) {
  return {
    ...data,
    _id: { toString: () => "account-id" },
    toObject: () => ({
      ...data,
      _id: { toString: () => "account-id" },
    }),
  };
}
const accountCreateMock = mock(async (data: Record<string, unknown>) =>
  createAccountDocument(data),
);

mock.module("next/cache", () => ({ revalidatePath: revalidatePathMock }));
mock.module("@/lib/require-admin", () => ({
  getAdminSession: mock(async () => ({
    user: { email: "admin@example.com", role: "admin", emailVerified: true },
  })),
  requireAdmin: requireAdminMock,
}));
mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/lib/email", () => ({ createImapClient: createImapClientMock }));
mock.module("@/lib/safe-email-password", () => ({
  encryptPassword: encryptPasswordMock,
}));
mock.module("@/lib/smtp", () => ({
  isSmtpConfigured: (account: { smtpHost?: string }) =>
    Boolean(account.smtpHost),
  sendMailFromAccount: mock(async () => ({})),
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
  verifySmtpConnection: verifySmtpConnectionMock,
}));
mock.module("@/models/EmailAccount", () => ({
  EmailAccountModel: {
    find: accountFindMock,
    findById: mock(() => ({ lean: mock(async () => null) })),
    findByIdAndUpdate: mock(async () => ({})),
    findOne: accountFindOneMock,
    create: accountCreateMock,
  },
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
  requireAdminMock.mockReset();
  requireAdminMock.mockResolvedValue(null);
  connectDBMock.mockClear();
  mailboxOpenMock.mockClear();
  logoutMock.mockClear();
  createImapClientMock.mockReset();
  createImapClientMock.mockResolvedValue({
    mailboxOpen: mailboxOpenMock,
    logout: logoutMock,
  });
  verifySmtpConnectionMock.mockReset();
  verifySmtpConnectionMock.mockResolvedValue(undefined);
  encryptPasswordMock.mockClear();
  revalidatePathMock.mockClear();
  accountLeanMock.mockReset();
  accountLeanMock.mockResolvedValue([]);
  accountFindMock.mockClear();
  accountFindOneMock.mockReset();
  accountFindOneMock.mockResolvedValue(null);
  accountCreateMock.mockReset();
  accountCreateMock.mockImplementation(async (data: Record<string, unknown>) =>
    createAccountDocument(data),
  );
});

describe("/api/admin/email-accounts", () => {
  test("GET excludes encrypted IMAP and SMTP fields", async () => {
    accountLeanMock.mockResolvedValue([
      {
        _id: { toString: () => "account-id" },
        provider: "gmail",
        host: "imap.gmail.com",
        port: 993,
        secure: true,
        user: "me@example.com",
        imapPassword: { ciphertext: "imap", iv: "iv", authTag: "tag" },
        smtpHost: "smtp.gmail.com",
        smtpPassword: { ciphertext: "smtp", iv: "iv", authTag: "tag" },
        inboxName: "INBOX",
        lastUid: 0,
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/admin/email-accounts") as Parameters<
        typeof GET
      >[0],
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts[0].imapPassword).toBeUndefined();
    expect(body.accounts[0].smtpPassword).toBeUndefined();
    expect(body.accounts[0].smtpConfigured).toBe(true);
  });

  test("POST accepts SMTP fields and stores encrypted credentials", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/email-accounts", {
        method: "POST",
        body: JSON.stringify({
          provider: "gmail",
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          user: "me@example.com",
          password: "imap-pass",
          inboxName: "INBOX",
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
          smtpSecure: true,
          smtpRequireTls: false,
          useSameCredentialsForSending: false,
          smtpUser: "me@example.com",
          smtpPassword: "smtp-pass",
        }),
      }) as Parameters<typeof POST>[0],
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.account.smtpPassword).toBeUndefined();
    expect(verifySmtpConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        pass: "smtp-pass",
      }),
    );
    expect(accountCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        smtpPassword: {
          ciphertext: "encrypted:smtp-pass",
          iv: "iv",
          authTag: "tag",
        },
        smtpPasswordSharedWithImap: false,
      }),
    );
  });

  test("POST does not enable provider SMTP defaults when SMTP is disabled", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/email-accounts", {
        method: "POST",
        body: JSON.stringify({
          provider: "gmail",
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          user: "me@example.com",
          password: "imap-pass",
          inboxName: "INBOX",
          smtpEnabled: false,
        }),
      }) as Parameters<typeof POST>[0],
    );

    expect(response.status).toBe(201);
    expect(verifySmtpConnectionMock).not.toHaveBeenCalled();
    expect(accountCreateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({
        smtpHost: "smtp.gmail.com",
      }),
    );
  });

  test("POST returns generic 400 when SMTP verification fails", async () => {
    verifySmtpConnectionMock.mockRejectedValue(new Error("bad password"));

    const response = await POST(
      new Request("http://localhost/api/admin/email-accounts", {
        method: "POST",
        body: JSON.stringify({
          provider: "gmail",
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          user: "me@example.com",
          password: "imap-pass",
          smtpHost: "smtp.gmail.com",
          smtpPort: 465,
          smtpSecure: true,
          useSameCredentialsForSending: true,
        }),
      }) as Parameters<typeof POST>[0],
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Failed to verify SMTP sending");
    expect(body.error).not.toContain("imap-pass");
    expect(accountCreateMock).not.toHaveBeenCalled();
  });

  test("POST returns 400 when unique email account index rejects a duplicate", async () => {
    accountCreateMock.mockRejectedValue(
      Object.assign(new Error("duplicate key"), {
        code: 11000,
        keyPattern: { user: 1, host: 1 },
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/admin/email-accounts", {
        method: "POST",
        body: JSON.stringify({
          provider: "gmail",
          host: "imap.gmail.com",
          port: 993,
          secure: true,
          user: "me@example.com",
          password: "imap-pass",
          inboxName: "INBOX",
        }),
      }) as Parameters<typeof POST>[0],
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "An account with this email and host already exists",
    );
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
