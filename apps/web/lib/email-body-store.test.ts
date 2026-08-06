import { beforeEach, describe, expect, mock, test } from "bun:test";
import mongoose from "mongoose";
import { BODY_MAX_CHARS } from "@/models/EmailBody";

interface BulkOperation {
  updateOne: {
    filter: { emailId: mongoose.Types.ObjectId };
    update: { $set: Record<string, unknown> };
    upsert: boolean;
  };
}

const bulkWriteMock = mock(async (operations: BulkOperation[]) => ({
  modifiedCount: 0,
  upsertedCount: operations.length,
}));
const storedEmailIds: string[] = [];
const fetchEmailBodiesMock = mock(
  async (_accountId: string, uids: number[]) => ({
    bodies: new Map(
      uids.map((uid) => [
        uid,
        {
          attachmentCount: 0,
          attachmentText: [],
          date: new Date(),
          from: [],
          html: `<p>uid ${uid}</p>`,
          subject: "",
          text: `uid ${uid}`,
        },
      ]),
    ),
    missingUids: new Set<number>(),
  }),
);

// The real BODY_MAX_CHARS, not a copy: re-declaring it in the mock would let
// the constant and the test drift apart silently.
const { BODY_MAX_CHARS: REAL_MAX } = await import("@/models/EmailBody");
let storedBody: Record<string, unknown> | null = null;

mock.module("@/models/EmailBody", () => ({
  BODY_MAX_CHARS: REAL_MAX,
  EmailBodyModel: {
    bulkWrite: bulkWriteMock,
    find: () => ({
      select: () => ({
        lean: async () => storedEmailIds.map((id) => ({ emailId: id })),
      }),
    }),
    findOne: () => ({ select: () => ({ lean: async () => storedBody }) }),
  },
}));

mock.module("@/lib/email", () => ({ fetchEmailBodies: fetchEmailBodiesMock }));

const { readEmailBody, saveEmailBodies, warmEmailBodies } = await import(
  "@/lib/email-body-store"
);

function ref(uid: number, accountId = "a".repeat(24)) {
  return {
    accountId,
    emailId: new mongoose.Types.ObjectId().toString(),
    uid,
  };
}

function body(overrides: { text?: string; html?: string } = {}) {
  return {
    attachmentCount: 2,
    attachmentText: [],
    date: new Date(),
    from: [],
    html: overrides.html ?? "<p>hi</p>",
    subject: "hello",
    text: overrides.text ?? "hi",
  };
}

beforeEach(() => {
  bulkWriteMock.mockClear();
  fetchEmailBodiesMock.mockClear();
  storedEmailIds.length = 0;
  storedBody = null;
});

describe("saveEmailBodies", () => {
  test("writes nothing for an empty batch", async () => {
    expect(await saveEmailBodies([])).toBe(0);
    expect(bulkWriteMock).not.toHaveBeenCalled();
  });

  test("upserts on emailId so a resync replaces rather than duplicates", async () => {
    const entry = { body: body(), ref: ref(7) };
    await saveEmailBodies([entry]);
    const [operations] = bulkWriteMock.mock.calls[0] ?? [];
    expect(operations?.[0]?.updateOne.upsert).toBe(true);
    expect(String(operations?.[0]?.updateOne.filter.emailId)).toBe(
      entry.ref.emailId,
    );
  });

  test("truncates a body that would approach the document limit", async () => {
    await saveEmailBodies([
      { body: body({ text: "x".repeat(BODY_MAX_CHARS + 100) }), ref: ref(8) },
    ]);
    const [operations] = bulkWriteMock.mock.calls[0] ?? [];
    const update = operations?.[0]?.updateOne.update.$set;
    expect(String(update?.text)).toHaveLength(BODY_MAX_CHARS);
    expect(update?.truncated).toBe(true);
  });
});

describe("readEmailBody", () => {
  test("serves a stored body without touching IMAP", async () => {
    storedBody = {
      attachmentCount: 1,
      html: "<p>stored</p>",
      text: "stored",
      truncated: false,
    };
    const result = await readEmailBody(ref(3));
    expect(result?.text).toBe("stored");
    expect(fetchEmailBodiesMock).not.toHaveBeenCalled();
  });

  test("fetches once, stores, and returns what it fetched", async () => {
    const result = await readEmailBody(ref(4));
    expect(result?.text).toBe("uid 4");
    expect(fetchEmailBodiesMock).toHaveBeenCalledTimes(1);
    expect(bulkWriteMock).toHaveBeenCalledTimes(1);
  });

  test("reports the same truncation state the stored copy will have", async () => {
    // Hardcoding `false` here made the first read of an oversized body
    // disagree with every read after it.
    fetchEmailBodiesMock.mockImplementationOnce(async (_id, uids) => ({
      bodies: new Map(
        uids.map((uid) => [
          uid,
          {
            attachmentCount: 0,
            attachmentText: [],
            date: new Date(),
            from: [],
            html: "",
            subject: "",
            text: "x".repeat(REAL_MAX + 10),
          },
        ]),
      ),
      missingUids: new Set<number>(),
    }));
    const result = await readEmailBody(ref(5));
    expect(result?.truncated).toBe(true);
    expect(result?.text).toHaveLength(REAL_MAX);
  });

  test("returns null when the message is gone from the server", async () => {
    fetchEmailBodiesMock.mockImplementationOnce(async () => ({
      bodies: new Map(),
      missingUids: new Set([6]),
    }));
    expect(await readEmailBody(ref(6))).toBeNull();
  });
});

describe("warmEmailBodies", () => {
  test("opens one connection per account, not one per email", async () => {
    const accountA = "a".repeat(24);
    const accountB = "b".repeat(24);
    await warmEmailBodies([
      ref(1, accountA),
      ref(2, accountA),
      ref(3, accountA),
      ref(4, accountB),
    ]);
    expect(fetchEmailBodiesMock).toHaveBeenCalledTimes(2);
    expect(fetchEmailBodiesMock.mock.calls[0]?.[1]).toEqual([1, 2, 3]);
    expect(fetchEmailBodiesMock.mock.calls[1]?.[1]).toEqual([4]);
  });

  test("skips emails whose body is already stored", async () => {
    const already = ref(1);
    storedEmailIds.push(already.emailId);
    const result = await warmEmailBodies([already]);
    expect(fetchEmailBodiesMock).not.toHaveBeenCalled();
    expect(result).toEqual({ alreadyStored: 1, warmed: 0 });
  });

  test("one unreachable account does not stop the others", async () => {
    const accountA = "a".repeat(24);
    const accountB = "b".repeat(24);
    fetchEmailBodiesMock.mockImplementationOnce(async () => {
      throw new Error("IMAP down");
    });
    const result = await warmEmailBodies([ref(1, accountA), ref(2, accountB)]);
    expect(fetchEmailBodiesMock).toHaveBeenCalledTimes(2);
    expect(result.warmed).toBe(1);
  });
});
