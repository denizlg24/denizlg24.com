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
const emailByIdLeanMock = mock(async (): Promise<unknown> => null);
const emailFindByIdMock = mock(() => ({ lean: emailByIdLeanMock }));
const emailFindMock = mock(() => ({
  sort: mock(() => ({
    limit: mock(() => ({ lean: mock(async () => []) })),
  })),
}));
const fetchEmailBodyMock = mock(async (): Promise<unknown> => null);
const queryEmailMailboxMock = mock(
  async (
    _account: unknown,
    _options: unknown,
  ): Promise<{
    emails: unknown[];
    total: number;
  }> => ({ emails: [], total: 0 }),
);
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
mock.module("@/lib/email", () => ({
  fetchEmailBody: fetchEmailBodyMock,
  queryEmailMailbox: queryEmailMailboxMock,
}));
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
    findById: emailFindByIdMock,
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
  emailByIdLeanMock.mockReset();
  emailByIdLeanMock.mockResolvedValue(null);
  emailFindByIdMock.mockClear();
  fetchEmailBodyMock.mockReset();
  fetchEmailBodyMock.mockResolvedValue(null);
  queryEmailMailboxMock.mockReset();
  queryEmailMailboxMock.mockResolvedValue({ emails: [], total: 0 });
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
  test("query_emails searches live accounts and paginates merged results", async () => {
    const workAccount = {
      ...smtpAccount,
      displayName: "Work",
    };
    const personalAccount = {
      ...smtpAccount,
      _id: { toString: () => "personal-id" },
      user: "personal@example.com",
      displayName: "Personal",
    };
    accountLeanMock.mockResolvedValue([workAccount, personalAccount]);
    queryEmailMailboxMock.mockImplementation(async (account) => {
      if ((account as typeof personalAccount).user === personalAccount.user) {
        return {
          total: 2,
          emails: [
            {
              uid: 21,
              subject: "Personal July receipt",
              from: [{ address: "shop@example.com" }],
              to: [{ address: personalAccount.user }],
              date: new Date("2026-07-22T10:00:00.000Z"),
              seen: true,
              body: "EUR 18.00",
            },
            {
              uid: 20,
              subject: "Older personal receipt",
              from: [{ address: "shop@example.com" }],
              to: [{ address: personalAccount.user }],
              date: new Date("2026-07-02T10:00:00.000Z"),
              seen: true,
              body: "EUR 5.00",
            },
          ],
        };
      }
      return {
        total: 2,
        emails: [
          {
            uid: 12,
            subject: "Work July receipt",
            from: [{ address: "vendor@example.com" }],
            to: [{ address: workAccount.user }],
            date: new Date("2026-07-24T10:00:00.000Z"),
            seen: false,
            body: "EUR 42.00",
          },
          {
            uid: 11,
            subject: "Older work receipt",
            from: [{ address: "vendor@example.com" }],
            to: [{ address: workAccount.user }],
            date: new Date("2026-07-12T10:00:00.000Z"),
            seen: true,
            body: "EUR 9.00",
          },
        ],
      };
    });

    const result = (await getTool("query_emails").execute?.({
      query: "receipt",
      startDate: "2026-07-01",
      endDate: "2026-08-01",
      includeBody: true,
      limit: 2,
      offset: 1,
    })) as {
      emails: { subject: string; account: string }[];
      total: number;
      hasMore: boolean;
      nextOffset: number;
      partial: boolean;
    };

    expect(queryEmailMailboxMock).toHaveBeenCalledTimes(2);
    expect(queryEmailMailboxMock).toHaveBeenCalledWith(
      workAccount,
      expect.objectContaining({
        text: "receipt",
        since: new Date("2026-07-01"),
        before: new Date("2026-08-01"),
        candidateLimit: 3,
        scope: "all",
        includeBody: true,
        includeAttachmentText: true,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        total: 4,
        hasMore: true,
        nextOffset: 3,
        partial: false,
      }),
    );
    expect(result.emails).toEqual([
      expect.objectContaining({
        subject: "Personal July receipt",
        account: "personal@example.com",
      }),
      expect.objectContaining({
        subject: "Older work receipt",
        account: "sender@example.com",
      }),
    ]);
  });

  test("get_email fetches the message body without changing read state", async () => {
    emailByIdLeanMock.mockResolvedValue({
      _id: { toString: () => "email-id" },
      accountId: { toString: () => "account-id" },
      messageId: "<receipt@example.com>",
      subject: "Receipt",
      from: [{ address: "shop@example.com" }],
      date: new Date("2026-07-22T10:00:00.000Z"),
      seen: false,
      uid: 42,
    });
    fetchEmailBodyMock.mockResolvedValue({
      subject: "Receipt",
      from: [{ address: "shop@example.com" }],
      date: new Date("2026-07-22T10:00:00.000Z"),
      text: "Total: EUR 18.00",
      html: "<p>Total: EUR 18.00</p>",
      attachmentText: [],
    });

    const result = await getTool("get_email").execute?.({ id: "email-id" });

    expect(fetchEmailBodyMock).toHaveBeenCalledWith("account-id", 42, {
      includeAttachmentText: true,
    });
    expect(result).toEqual(
      expect.objectContaining({
        _id: "email-id",
        uid: 42,
        seen: false,
        body: "Total: EUR 18.00",
        bodyFormat: "text",
        bodyAvailable: true,
      }),
    );
  });

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
