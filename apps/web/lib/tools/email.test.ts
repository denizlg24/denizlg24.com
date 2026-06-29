import { beforeEach, describe, expect, mock, test } from "bun:test";

const connectDBMock = mock(async () => {});
const sendMailFromAccountMock = mock(async () => ({}));
const isSmtpConfiguredMock = mock(
  (account: { smtpConfigured?: boolean; smtpHost?: string }) =>
    account.smtpConfigured ?? Boolean(account.smtpHost),
);
const accountLeanMock = mock(async (): Promise<unknown[]> => []);
const accountFindMock = mock(() => ({ lean: accountLeanMock }));
const accountByIdLeanMock = mock(async (): Promise<unknown> => null);
const accountFindByIdMock = mock(() => ({ lean: accountByIdLeanMock }));
const accountFindOneMock = mock(() => ({ lean: mock(async () => null) }));
const emailFindMock = mock(() => ({
  sort: mock(() => ({
    limit: mock(() => ({ lean: mock(async () => []) })),
  })),
}));
const draftCreateMock = mock(async (data: Record<string, unknown>) => ({
  ...data,
  _id: { toString: () => "draft-id" },
  toObject: () => ({
    ...data,
    _id: { toString: () => "draft-id" },
    status: data.status ?? "draft",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  }),
}));
const draftLeanMock = mock(async (): Promise<unknown> => null);
const draftFindByIdMock = mock(() => ({ lean: draftLeanMock }));
const draftFindOneAndUpdateLeanMock = mock(async (): Promise<unknown> => null);
const draftFindOneAndUpdateMock = mock(() => ({
  lean: draftFindOneAndUpdateLeanMock,
}));
const draftFindByIdAndUpdateMock = mock(async () => ({}));

mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/lib/smtp", () => ({
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
  isSmtpConfigured: isSmtpConfiguredMock,
  sendMailFromAccount: sendMailFromAccountMock,
  verifySmtpConnection: mock(async () => {}),
}));
mock.module("@/models/Email", () => ({
  EmailModel: {
    find: emailFindMock,
    findById: mock(() => ({ lean: mock(async () => null) })),
    findByIdAndDelete: mock(() => ({ lean: mock(async () => null) })),
    findByIdAndUpdate: mock(() => ({ lean: mock(async () => null) })),
  },
}));
mock.module("@/models/EmailAccount", () => ({
  EmailAccountModel: {
    find: accountFindMock,
    findById: accountFindByIdMock,
    findOne: accountFindOneMock,
  },
}));
mock.module("@/models/EmailDraft", () => ({
  EmailDraftModel: {
    create: draftCreateMock,
    findById: draftFindByIdMock,
    findOneAndUpdate: draftFindOneAndUpdateMock,
    findByIdAndUpdate: draftFindByIdAndUpdateMock,
  },
}));

const { emailTools } = await import("./email");

function getTool(name: string) {
  const tool = emailTools.find((item) => item.schema.name === name);
  if (!tool?.execute) throw new Error(`Missing tool ${name}`);
  return tool;
}

const smtpAccount = {
  _id: { toString: () => "account-id" },
  user: "sender@example.com",
  displayName: "Work",
  provider: "gmail",
  smtpHost: "smtp.gmail.com",
  smtpConfigured: true,
};

beforeEach(() => {
  connectDBMock.mockClear();
  sendMailFromAccountMock.mockClear();
  isSmtpConfiguredMock.mockClear();
  accountLeanMock.mockReset();
  accountLeanMock.mockResolvedValue([]);
  accountFindMock.mockClear();
  accountByIdLeanMock.mockReset();
  accountByIdLeanMock.mockResolvedValue(null);
  accountFindByIdMock.mockClear();
  draftCreateMock.mockClear();
  draftLeanMock.mockReset();
  draftLeanMock.mockResolvedValue(null);
  draftFindByIdMock.mockClear();
  draftFindOneAndUpdateLeanMock.mockReset();
  draftFindOneAndUpdateLeanMock.mockResolvedValue(null);
  draftFindOneAndUpdateMock.mockClear();
  draftFindByIdAndUpdateMock.mockClear();
});

describe("email chat tools", () => {
  test("list_email_accounts redacts secrets and can filter sending accounts", async () => {
    accountLeanMock.mockResolvedValue([
      {
        ...smtpAccount,
        imapPassword: { ciphertext: "secret" },
        smtpPassword: { ciphertext: "smtp-secret" },
      },
      {
        _id: { toString: () => "read-only-id" },
        user: "read@example.com",
        smtpConfigured: false,
      },
    ]);

    const result = await getTool("list_email_accounts").execute?.({
      sendingOnly: true,
    });

    expect(result).toEqual([
      expect.objectContaining({
        _id: "account-id",
        user: "sender@example.com",
        smtpConfigured: true,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("generate_email_draft stores a draft without sending email", async () => {
    accountLeanMock.mockResolvedValue([smtpAccount]);

    const result = await getTool("generate_email_draft").execute?.({
      account: "sender@example.com",
      to: ["to@example.com"],
      subject: "Hello",
      text: "Draft body",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        draftId: "draft-id",
        from: "sender@example.com",
        to: ["to@example.com"],
        subject: "Hello",
        text: "Draft body",
      }),
    );
    expect(draftCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: smtpAccount._id,
        to: ["to@example.com"],
        status: "draft",
      }),
    );
    expect(sendMailFromAccountMock).not.toHaveBeenCalled();
  });

  test("request_send_email sends a stored draft and marks it sent", async () => {
    const draft = {
      _id: { toString: () => "draft-id" },
      accountId: "account-id",
      to: ["to@example.com"],
      cc: [],
      bcc: [],
      subject: "Hello",
      text: "Draft body",
      status: "draft",
    };
    draftFindOneAndUpdateLeanMock.mockResolvedValue(draft);
    accountByIdLeanMock.mockResolvedValue(smtpAccount);

    const result = await getTool("request_send_email").execute?.({
      draftId: "draft-id",
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        draftId: "draft-id",
        to: ["to@example.com"],
        subject: "Hello",
      }),
    );
    expect(sendMailFromAccountMock).toHaveBeenCalledWith(
      smtpAccount,
      expect.objectContaining({
        to: ["to@example.com"],
        subject: "Hello",
        text: "Draft body",
      }),
    );
    expect(draftFindOneAndUpdateMock).toHaveBeenCalledWith(
      { _id: "draft-id", status: "draft" },
      { status: "sending" },
      { returnDocument: "after" },
    );
    expect(draftFindByIdAndUpdateMock).toHaveBeenCalledWith(
      draft._id,
      expect.objectContaining({ status: "sent" }),
    );
  });

  test("request_send_email refuses drafts that were already sent", async () => {
    draftFindOneAndUpdateLeanMock.mockResolvedValue(null);
    draftLeanMock.mockResolvedValue({
      _id: { toString: () => "draft-id" },
      accountId: "account-id",
      to: ["to@example.com"],
      cc: [],
      bcc: [],
      subject: "Hello",
      text: "Draft body",
      status: "sent",
    });

    await expect(
      getTool("request_send_email").execute?.({ draftId: "draft-id" }),
    ).rejects.toThrow("Email draft was already sent");
    expect(sendMailFromAccountMock).not.toHaveBeenCalled();
  });

  test("request_send_email refuses drafts that are already being sent", async () => {
    draftFindOneAndUpdateLeanMock.mockResolvedValue(null);
    draftLeanMock.mockResolvedValue({
      _id: { toString: () => "draft-id" },
      accountId: "account-id",
      to: ["to@example.com"],
      cc: [],
      bcc: [],
      subject: "Hello",
      text: "Draft body",
      status: "sending",
    });

    await expect(
      getTool("request_send_email").execute?.({ draftId: "draft-id" }),
    ).rejects.toThrow("Email draft is already being sent");
    expect(sendMailFromAccountMock).not.toHaveBeenCalled();
  });

  test("request_send_email restores a reserved draft when sending fails", async () => {
    const draft = {
      _id: { toString: () => "draft-id" },
      accountId: "account-id",
      to: ["to@example.com"],
      cc: [],
      bcc: [],
      subject: "Hello",
      text: "Draft body",
      status: "sending",
    };
    draftFindOneAndUpdateLeanMock.mockResolvedValue(draft);
    accountByIdLeanMock.mockResolvedValue(smtpAccount);
    sendMailFromAccountMock.mockRejectedValue(new Error("SMTP failed"));

    await expect(
      getTool("request_send_email").execute?.({ draftId: "draft-id" }),
    ).rejects.toThrow("SMTP failed");

    expect(draftFindOneAndUpdateMock).toHaveBeenCalledWith(
      { _id: draft._id, status: "sending" },
      { status: "draft" },
    );
    expect(draftFindByIdAndUpdateMock).not.toHaveBeenCalled();
  });
});
