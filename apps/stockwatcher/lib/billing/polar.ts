import "server-only";
import { createPolar, webhooks } from "@polar-sh/sdk/2026-10";
import { adjustPaid, MC_PER_CREDIT, refundedFor } from "./credits";

export const polarReady = () =>
  Boolean(process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_WEBHOOK_SECRET);

const environment = () =>
  process.env.POLAR_ENVIRONMENT === "production" ? "production" : "sandbox";

let client: ReturnType<typeof createPolar> | undefined;
export function polar() {
  const accessToken = process.env.POLAR_ACCESS_TOKEN;
  if (!accessToken) throw new Error("Polar is not configured.");
  client ??= createPolar({
    accessToken,
    environment: environment(),
    timeout: 15,
  });
  return client;
}

export type CreditPack = {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  priceAmount: number;
  currency: string;
};

const packCredits = (metadata: Record<string, unknown>) => {
  const value = Number(metadata.credits);
  return Number.isInteger(value) && value > 0 ? value : null;
};

let packCache: { at: number; packs: CreditPack[] } | undefined;

/** One-time Polar products carrying `metadata.credits`, cheapest first. */
export async function creditPacks(): Promise<CreditPack[]> {
  if (packCache && Date.now() - packCache.at < 5 * 60_000)
    return packCache.packs;
  const packs: CreditPack[] = [];
  for await (const product of polar().products.iterList({
    is_archived: false,
    is_recurring: false,
  })) {
    const credits = packCredits(product.metadata);
    const price = product.prices.find(
      (item) => item.amount_type === "fixed" && !item.is_archived,
    );
    if (!credits || !price || price.amount_type !== "fixed") continue;
    packs.push({
      id: product.id,
      name: product.name,
      description: product.description,
      credits,
      priceAmount: price.price_amount,
      currency: price.price_currency,
    });
  }
  packs.sort((a, b) => a.priceAmount - b.priceAmount);
  packCache = { at: Date.now(), packs };
  return packs;
}

export async function createCheckout(input: {
  userId: string;
  email: string | null;
  productId: string;
  origin: string;
}) {
  const pack = (await creditPacks()).find(
    (item) => item.id === input.productId,
  );
  if (!pack) return null;
  const checkout = await polar().checkouts.create({
    products: [pack.id],
    external_customer_id: input.userId,
    ...(input.email ? { customer_email: input.email } : {}),
    success_url: `${input.origin}/account?checkout={CHECKOUT_ID}`,
    return_url: `${input.origin}/account`,
    metadata: { user_id: input.userId, credits: pack.credits },
  });
  return checkout.url;
}

export async function portalUrl(userId: string) {
  const session = await polar().customerSessions.create({
    external_customer_id: userId,
  });
  return session.customer_portal_url;
}

export type WebhookOutcome =
  | { status: 202; result: string }
  | { status: 400 | 403; error: string };

/** Verifies and applies a Polar webhook. Every write is idempotent by ledger ref. */
export async function handleWebhook(
  body: string,
  headers: Headers,
): Promise<WebhookOutcome> {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) return { status: 403, error: "Webhooks are not configured." };
  let event: Awaited<ReturnType<typeof webhooks.validateEvent>>;
  try {
    event = await webhooks.validateEvent(
      body,
      {
        "webhook-id": headers.get("webhook-id") ?? "",
        "webhook-timestamp": headers.get("webhook-timestamp") ?? "",
        "webhook-signature": headers.get("webhook-signature") ?? "",
      },
      secret,
    );
  } catch (error) {
    if (error instanceof webhooks.PolarWebhookVerificationError)
      return { status: 403, error: "Invalid webhook signature." };
    if (error instanceof webhooks.PolarWebhookUnknownTypeError)
      return { status: 202, result: "ignored" };
    return { status: 400, error: "Invalid webhook payload." };
  }

  if (event.type !== "order.paid" && event.type !== "order.refunded")
    return { status: 202, result: "ignored" };
  const order = event.data;
  const userId =
    order.customer.external_id ??
    (typeof order.metadata.user_id === "string"
      ? order.metadata.user_id
      : null);
  const credits =
    packCredits(order.metadata) ?? packCredits(order.product?.metadata ?? {});
  if (!userId || !credits) return { status: 202, result: "not a credit order" };

  if (event.type === "order.paid") {
    const granted = await adjustPaid({
      userId,
      amountMc: credits * MC_PER_CREDIT,
      kind: "purchase",
      ref: `polar:order:${order.id}`,
      meta: {
        orderId: order.id,
        credits,
        amount: order.total_amount,
        currency: order.currency,
        product: order.product?.name ?? null,
      },
    });
    return { status: 202, result: granted ? "granted" : "duplicate" };
  }

  if (order.total_amount <= 0)
    return { status: 202, result: "nothing to refund" };
  const target = Math.round(
    (credits *
      MC_PER_CREDIT *
      Math.min(order.refunded_amount, order.total_amount)) /
      order.total_amount,
  );
  const owed = target - (await refundedFor(order.id));
  if (owed <= 0) return { status: 202, result: "duplicate" };
  await adjustPaid({
    userId,
    amountMc: -owed,
    kind: "refund",
    ref: `polar:refund:${order.id}:${order.refunded_amount}`,
    meta: {
      orderId: order.id,
      refundedAmount: order.refunded_amount,
      currency: order.currency,
    },
  });
  return { status: 202, result: "reversed" };
}
