import { beforeAll, describe, expect, mock, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";

const url = process.env.STOCKWATCHER_TEST_DATABASE_URL;

// Runs only against a disposable database:
//   STOCKWATCHER_TEST_DATABASE_URL=postgres://… bun test lib/billing
describe.skipIf(!url)("credits ledger", () => {
  let credits: typeof import("./credits");

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.BILLING = "1";
    process.env.FREE_CREDITS_MONTHLY = "1";
    process.env.CREDIT_FLOOR = "1";
    process.env.CHAT_RESERVE_CREDITS = "5";
    process.env.CREDIT_MARKUP = "2";
    mock.module("server-only", () => ({}));
    credits = await import("./credits");
    polar = await import("./polar");
  });

  let polar: typeof import("./polar");
  const secret = `whsec_${Buffer.from("stockwatcher-test-secret").toString("base64")}`;

  function signed(payload: unknown, key = secret) {
    const body = JSON.stringify(payload);
    const id = `msg_${randomUUID()}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", Buffer.from(key.slice(6), "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
    return {
      body,
      headers: new Headers({
        "webhook-id": id,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      }),
    };
  }

  const order = (userId: string, orderId: string, refunded = 0) => ({
    id: orderId,
    total_amount: 1000,
    net_amount: 1000,
    refunded_amount: refunded,
    currency: "eur",
    metadata: { user_id: userId, credits: 1200 },
    customer: { external_id: userId },
    product: {
      name: "Stockwatcher 1,200 credits",
      metadata: { credits: 1200 },
    },
  });

  const user = () => ({ id: `test|${randomUUID()}`, demo: false });

  test("a new account starts with the monthly free credits", async () => {
    const balance = await credits.balance(user().id);
    expect(balance.free).toBe(1);
    expect(balance.paid).toBe(0);
    expect(balance.available).toBe(1);
  });

  test("usage drains free first, overdraws paid once, then refuses", async () => {
    const someone = user();
    const first = await credits.reserve(someone);
    if (!first.ok) throw new Error("first request should pass");
    const charged = await credits.settle(someone, first, {
      ref: `run:${randomUUID()}`,
      costUsd: 0.02,
      source: "chat",
    });
    expect(charged).toBe(4);
    const after = await credits.balance(someone.id);
    expect(after.free).toBe(0);
    expect(after.paid).toBe(-3);
    expect(after.held).toBe(0);
    const second = await credits.reserve(someone);
    expect(second.ok).toBe(false);
  });

  test("settling the same run twice charges once", async () => {
    const someone = user();
    await credits.adjustPaid({
      userId: someone.id,
      amountMc: 10_000,
      kind: "purchase",
      ref: `polar:order:${randomUUID()}`,
      meta: {},
    });
    const ref = `run:${randomUUID()}`;
    const hold = await credits.reserve(someone);
    if (!hold.ok) throw new Error("should pass");
    await credits.settle(someone, hold, { ref, costUsd: 0.01, source: "chat" });
    await credits.settle(someone, hold, { ref, costUsd: 0.01, source: "chat" });
    const balance = await credits.balance(someone.id);
    expect(balance.available).toBe(11 - 2);
  });

  test("a purchase replayed with the same ref grants once", async () => {
    const someone = user();
    const ref = `polar:order:${randomUUID()}`;
    const grant = () =>
      credits.adjustPaid({
        userId: someone.id,
        amountMc: 500_000,
        kind: "purchase",
        ref,
        meta: { orderId: "o" },
      });
    expect(await grant()).toBe(true);
    expect(await grant()).toBe(false);
    expect((await credits.balance(someone.id)).paid).toBe(500);
  });

  test("parallel requests cannot all reserve the same credits", async () => {
    const someone = user();
    await credits.adjustPaid({
      userId: someone.id,
      amountMc: 9_000,
      kind: "purchase",
      ref: `polar:order:${randomUUID()}`,
      meta: {},
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, () => credits.reserve(someone)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
    const balance = await credits.balance(someone.id);
    expect(balance.held).toBe(10);
    for (const result of results) if (result.ok) await credits.release(result);
    expect((await credits.balance(someone.id)).held).toBe(0);
  });

  test("a hold grows only as far as the account can cover", async () => {
    const someone = user();
    await credits.adjustPaid({
      userId: someone.id,
      amountMc: 19_000,
      kind: "purchase",
      ref: `polar:order:${randomUUID()}`,
      meta: {},
    });
    const other = await credits.reserve(someone, 4_000);
    const hold = await credits.reserve(someone, 5_000, 5_000);
    if (!hold.ok || !hold.holdId || !other.ok)
      throw new Error("both should pass");
    expect(hold.amountMc).toBe(5_000);
    expect(await credits.extendHold(someone.id, hold.holdId, 12_000)).toBe(
      12_000,
    );
    expect(await credits.extendHold(someone.id, hold.holdId, 50_000)).toBe(
      16_000,
    );
    expect(await credits.extendHold(someone.id, hold.holdId, 1_000)).toBe(
      16_000,
    );
    expect((await credits.balance(someone.id)).held).toBe(20);
  });

  test("a reply larger than the balance is refused up front", async () => {
    const someone = user();
    const result = await credits.reserve(someone, 30_000, 25_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.requiredCredits).toBe(25);
  });

  test("a signed order.paid grants its credits once", async () => {
    process.env.POLAR_WEBHOOK_SECRET = secret;
    const someone = user();
    const orderId = randomUUID();
    const event = {
      type: "order.paid",
      timestamp: new Date().toISOString(),
      data: order(someone.id, orderId),
    };
    const first = signed(event);
    expect(await polar.handleWebhook(first.body, first.headers)).toEqual({
      status: 202,
      result: "granted",
    });
    const replay = signed(event);
    expect(await polar.handleWebhook(replay.body, replay.headers)).toEqual({
      status: 202,
      result: "duplicate",
    });
    expect((await credits.balance(someone.id)).paid).toBe(1200);

    const half = signed({
      type: "order.refunded",
      timestamp: new Date().toISOString(),
      data: order(someone.id, orderId, 500),
    });
    expect((await polar.handleWebhook(half.body, half.headers)).status).toBe(
      202,
    );
    expect((await credits.balance(someone.id)).paid).toBe(600);
    const full = signed({
      type: "order.refunded",
      timestamp: new Date().toISOString(),
      data: order(someone.id, orderId, 1000),
    });
    await polar.handleWebhook(full.body, full.headers);
    await polar.handleWebhook(full.body, full.headers);
    expect((await credits.balance(someone.id)).paid).toBe(0);
  });

  test("a full refund of a taxed order reverses every credit", async () => {
    process.env.POLAR_WEBHOOK_SECRET = secret;
    const someone = user();
    const orderId = randomUUID();
    const taxed = (refunded: number) => ({
      ...order(someone.id, orderId, refunded),
      net_amount: 1000,
      total_amount: 1200,
    });
    const paid = signed({
      type: "order.paid",
      timestamp: new Date().toISOString(),
      data: taxed(0),
    });
    await polar.handleWebhook(paid.body, paid.headers);
    const refund = signed({
      type: "order.refunded",
      timestamp: new Date().toISOString(),
      data: taxed(1000),
    });
    await polar.handleWebhook(refund.body, refund.headers);
    expect((await credits.balance(someone.id)).paid).toBe(0);
  });

  test("overlapping deliveries of growing refunds reverse only the total", async () => {
    process.env.POLAR_WEBHOOK_SECRET = secret;
    const someone = user();
    const orderId = randomUUID();
    const paid = signed({
      type: "order.paid",
      timestamp: new Date().toISOString(),
      data: order(someone.id, orderId),
    });
    await polar.handleWebhook(paid.body, paid.headers);
    const deliveries = [250, 500, 500, 250].map((refunded) =>
      signed({
        type: "order.refunded",
        timestamp: new Date().toISOString(),
        data: order(someone.id, orderId, refunded),
      }),
    );
    await Promise.all(
      deliveries.map((delivery) =>
        polar.handleWebhook(delivery.body, delivery.headers),
      ),
    );
    expect((await credits.balance(someone.id)).paid).toBe(600);
  });

  test("an order fully covered by a promo code still grants the pack", async () => {
    process.env.POLAR_WEBHOOK_SECRET = secret;
    const someone = user();
    const free = {
      ...order(someone.id, randomUUID()),
      total_amount: 0,
      net_amount: 0,
    };
    const paid = signed({
      type: "order.paid",
      timestamp: new Date().toISOString(),
      data: free,
    });
    expect(await polar.handleWebhook(paid.body, paid.headers)).toEqual({
      status: 202,
      result: "granted",
    });
    expect((await credits.balance(someone.id)).paid).toBe(1200);
  });

  test("a forged webhook is refused and grants nothing", async () => {
    process.env.POLAR_WEBHOOK_SECRET = secret;
    const someone = user();
    const forged = signed(
      {
        type: "order.paid",
        timestamp: new Date().toISOString(),
        data: order(someone.id, randomUUID()),
      },
      `whsec_${Buffer.from("not-the-secret").toString("base64")}`,
    );
    expect(
      (await polar.handleWebhook(forged.body, forged.headers)).status,
    ).toBe(403);
    expect((await credits.balance(someone.id)).paid).toBe(0);
  });

  test("preview sessions bypass billing", async () => {
    const preview = { id: `demo|${randomUUID()}`, demo: true };
    const hold = await credits.reserve(preview);
    expect(hold).toEqual({
      ok: true,
      holdId: null,
      metered: false,
      amountMc: 0,
    });
  });

  test("gateway cost sums string costs and counts missing steps", () => {
    expect(
      credits.gatewayCost([
        { providerMetadata: { gateway: { cost: "0.0125" } } },
        { providerMetadata: { gateway: { cost: "0.0075" } } },
        { providerMetadata: {} },
      ]),
    ).toEqual({ costUsd: 0.02, missing: 1 });
    expect(credits.chargeFor(0.02)).toBe(4000);
  });
});
