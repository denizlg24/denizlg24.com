import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { NextResponse } from "next/server";

const requireAdminMock = mock(async () => null as NextResponse | null);
const connectDBMock = mock(async () => {});
const decryptSecretMock = mock(
  (secret: { ciphertext: string }) => `decrypted:${secret.ciphertext}`,
);
const encryptPasswordMock = mock((value: string) => ({
  ciphertext: `encrypted:${value}`,
  iv: "iv",
  authTag: "tag",
}));
const verifySmtpConnectionMock = mock(async (_settings: unknown) => {});
const revalidatePathMock = mock((_path: string) => {});
const accountLeanMock = mock(async (): Promise<unknown> => null);
const accountUpdateLeanMock = mock(async (): Promise<unknown> => null);
const accountFindByIdMock = mock(() => ({ lean: accountLeanMock }));
const accountFindByIdAndUpdateMock = mock(() => ({
  lean: accountUpdateLeanMock,
}));
const accountFindByIdAndDeleteMock = mock(async () => null);
const emailDeleteManyMock = mock(async () => ({}));

mock.module("next/cache", () => ({ revalidatePath: revalidatePathMock }));
mock.module("@/lib/require-admin", () => ({
  getAdminSession: mock(async () => ({
    user: { email: "admin@example.com", role: "admin", emailVerified: true },
  })),
  requireAdmin: requireAdminMock,
}));
mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/lib/encrypted-secret", () => ({
  decryptSecret: decryptSecretMock,
  encryptSecret: encryptPasswordMock,
}));
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
mock.module("@/models/Email", () => ({
  EmailModel: {
    deleteMany: emailDeleteManyMock,
  },
}));
mock.module("@/models/EmailAccount", () => ({
  EmailAccountModel: {
    create: mock(async () => ({})),
    find: mock(() => ({ lean: mock(async () => []) })),
    findById: accountFindByIdMock,
    findByIdAndDelete: accountFindByIdAndDeleteMock,
    findByIdAndUpdate: accountFindByIdAndUpdateMock,
    findOne: mock(async () => null),
  },
}));

const { PATCH } = await import("./route");

const encryptedImapSecret = {
  ciphertext: "imap-secret",
  iv: "imap-iv",
  authTag: "imap-tag",
};
const encryptedSmtpSecret = {
  ciphertext: "smtp-secret",
  iv: "smtp-iv",
  authTag: "smtp-tag",
};

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/email-accounts/account-id", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as Parameters<typeof PATCH>[0];
}

const params = { params: Promise.resolve({ id: "account-id" }) };

function existingAccount(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => "account-id" },
    provider: "gmail",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    user: "me@example.com",
    imapPassword: encryptedImapSecret,
    inboxName: "INBOX",
    lastUid: 0,
    ...overrides,
  };
}

beforeEach(() => {
  requireAdminMock.mockReset();
  requireAdminMock.mockResolvedValue(null);
  connectDBMock.mockClear();
  decryptSecretMock.mockClear();
  encryptPasswordMock.mockClear();
  verifySmtpConnectionMock.mockReset();
  verifySmtpConnectionMock.mockResolvedValue(undefined);
  revalidatePathMock.mockClear();
  accountLeanMock.mockReset();
  accountLeanMock.mockResolvedValue(existingAccount());
  accountUpdateLeanMock.mockReset();
  accountUpdateLeanMock.mockResolvedValue(
    existingAccount({
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpRequireTls: false,
      smtpUser: "me@example.com",
      smtpPasswordSharedWithImap: true,
    }),
  );
  accountFindByIdMock.mockClear();
  accountFindByIdAndUpdateMock.mockClear();
  accountFindByIdAndDeleteMock.mockClear();
  emailDeleteManyMock.mockClear();
});

describe("PATCH /api/admin/email-accounts/[id]", () => {
  test("adds SMTP sending to an existing account with shared IMAP credentials", async () => {
    const response = await PATCH(
      patchRequest({
        provider: "gmail",
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpRequireTls: false,
        useSameCredentialsForSending: true,
      }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.account.imapPassword).toBeUndefined();
    expect(body.account.smtpPassword).toBeUndefined();
    expect(body.account.smtpConfigured).toBe(true);
    expect(verifySmtpConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        pass: "decrypted:imap-secret",
        user: "me@example.com",
      }),
    );
    expect(accountFindByIdAndUpdateMock).toHaveBeenCalledWith(
      "account-id",
      expect.objectContaining({
        $set: expect.objectContaining({
          smtpHost: "smtp.gmail.com",
          smtpPasswordSharedWithImap: true,
        }),
        $unset: expect.objectContaining({
          lastSmtpError: "",
          smtpPassword: "",
        }),
      }),
      { returnDocument: "after" },
    );
  });

  test("keeps an existing dedicated SMTP password when no replacement is provided", async () => {
    accountLeanMock.mockResolvedValue(
      existingAccount({
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpRequireTls: false,
        smtpUser: "smtp@example.com",
        smtpPassword: encryptedSmtpSecret,
        smtpPasswordSharedWithImap: false,
      }),
    );
    accountUpdateLeanMock.mockResolvedValue(
      existingAccount({
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpRequireTls: false,
        smtpUser: "smtp@example.com",
        smtpPassword: encryptedSmtpSecret,
        smtpPasswordSharedWithImap: false,
        smtpFromName: "Me",
      }),
    );

    const response = await PATCH(
      patchRequest({
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpRequireTls: false,
        useSameCredentialsForSending: false,
        smtpUser: "smtp@example.com",
        smtpFromName: "Me",
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(verifySmtpConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pass: "decrypted:smtp-secret",
        user: "smtp@example.com",
      }),
    );
    const updateCalls = accountFindByIdAndUpdateMock.mock.calls as unknown as [
      string,
      { $set: Record<string, unknown> },
      unknown,
    ][];
    const update = updateCalls[0]?.[1];
    expect(update).toBeDefined();
    expect(update?.$set.smtpPassword).toBeUndefined();
    expect(encryptPasswordMock).not.toHaveBeenCalled();
  });

  test("updates non-SMTP fields without retesting existing SMTP settings", async () => {
    accountLeanMock.mockResolvedValue(
      existingAccount({
        displayName: "Old name",
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpRequireTls: false,
        smtpPassword: encryptedSmtpSecret,
        smtpPasswordSharedWithImap: false,
      }),
    );
    accountUpdateLeanMock.mockResolvedValue(
      existingAccount({
        displayName: "Work",
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpRequireTls: false,
        smtpPassword: encryptedSmtpSecret,
        smtpPasswordSharedWithImap: false,
      }),
    );

    const response = await PATCH(
      patchRequest({
        displayName: "Work",
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(verifySmtpConnectionMock).not.toHaveBeenCalled();
    const updateCalls = accountFindByIdAndUpdateMock.mock.calls as unknown as [
      string,
      { $set: Record<string, unknown> },
      unknown,
    ][];
    const update = updateCalls[0]?.[1];
    expect(update?.$set.displayName).toBe("Work");
    expect(update?.$set.lastSmtpTestAt).toBeUndefined();
  });

  test("returns a generic 400 when SMTP verification fails", async () => {
    verifySmtpConnectionMock.mockRejectedValue(new Error("535 imap-secret"));

    const response = await PATCH(
      patchRequest({
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpRequireTls: false,
        useSameCredentialsForSending: true,
      }),
      params,
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("Failed to verify SMTP sending");
    expect(body.error).not.toContain("imap-secret");
    expect(accountFindByIdAndUpdateMock).toHaveBeenCalledTimes(1);
    expect(accountFindByIdAndUpdateMock).toHaveBeenCalledWith("account-id", {
      $set: {
        lastSmtpError:
          "Failed to verify SMTP sending. Check the SMTP server, port, and credentials.",
      },
    });
  });

  test("returns 404 when the account does not exist", async () => {
    accountLeanMock.mockResolvedValue(null);

    const response = await PATCH(
      patchRequest({
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        useSameCredentialsForSending: true,
      }),
      params,
    );

    expect(response.status).toBe(404);
    expect(verifySmtpConnectionMock).not.toHaveBeenCalled();
  });
});
