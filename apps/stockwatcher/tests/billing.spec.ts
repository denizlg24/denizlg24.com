import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl = process.env.STOCKWATCHER_E2E_DATABASE_URL;
const origin = { Origin: "http://127.0.0.1:3290" };

test.skip(
  !databaseUrl || !process.env.STOCKWATCHER_E2E_AI_KEY,
  "Billing e2e needs STOCKWATCHER_E2E_DATABASE_URL and STOCKWATCHER_E2E_AI_KEY.",
);

type Billing = {
  enabled: boolean;
  balance: { available: number; free: number; paid: number; held: number };
  ledger: Array<{ kind: string; credits: number; threadId: string | null }>;
};

async function signIn(page: Page, name: "Alice" | "Bob") {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByRole("link", { name: `Continue as ${name}` }).click();
  await expect(
    page.getByRole("heading", { name: "Desk", level: 1 }),
  ).toBeVisible();
}

const billing = async (page: Page) =>
  (await (await page.request.get("/api/billing")).json()) as Billing;

const ask = (page: Page, text: string, id = randomUUID()) =>
  page.request.post("/api/chat", {
    headers: origin,
    data: {
      id,
      messages: [
        { id: randomUUID(), role: "user", parts: [{ type: "text", text }] },
      ],
    },
    timeout: 120_000,
  });

test("a chat reply is charged at gateway cost and shown on the reply", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, "Alice");
  expect((await billing(page)).enabled).toBe(true);

  const threadId = randomUUID();
  const response = await ask(
    page,
    "Reply with the single word: ready.",
    threadId,
  );
  expect(response.status()).toBe(200);
  const stream = await response.text();
  const metadata = stream.match(/"messageMetadata":\{"credits":([\d.]+)\}/);
  expect(metadata, "finish chunk carries the charge").not.toBeNull();
  const shown = Number(metadata?.[1]);
  expect(shown).toBeGreaterThan(0);

  // The desk also writes the daily brief on first visit, which holds and
  // charges credits of its own; wait for every request to settle.
  await expect
    .poll(
      async () => {
        const state = await billing(page);
        return (
          state.balance.held === 0 &&
          state.ledger.some((entry) => entry.threadId === threadId)
        );
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const after = await billing(page);
  const usage = after.ledger.find((entry) => entry.threadId === threadId);
  expect(usage?.credits).toBeCloseTo(-shown, 2);
  const spent = after.ledger
    .filter((entry) => entry.kind === "usage")
    .reduce((sum, entry) => sum - entry.credits, 0);
  expect(after.balance.available).toBeCloseTo(100 - spent, 2);

  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Plan & credits", level: 1 }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("cell", {
        name: "Assistant · Reply with the single word: ready.",
      })
      .first(),
  ).toBeVisible();
  if (process.env.STOCKWATCHER_E2E_SCREENSHOT)
    await page.screenshot({
      path: process.env.STOCKWATCHER_E2E_SCREENSHOT,
      fullPage: true,
    });
});

test("an empty balance refuses the next request with 402", async ({ page }) => {
  await signIn(page, "Bob");
  await billing(page);
  const sql = postgres(databaseUrl ?? "", { max: 1 });
  try {
    await sql`
      UPDATE stockwatcher_credit_accounts SET free_mc = 0, paid_mc = 0
      WHERE user_id LIKE ${"%|bob"}`;
  } finally {
    await sql.end();
  }
  const response = await ask(page, "Hello");
  expect(response.status()).toBe(402);
  expect(await response.json()).toMatchObject({ code: "out_of_credits" });

  await page.goto("/");
  await page.getByRole("button", { name: /Ask Stockwatcher/ }).click();
  const input = page.getByRole("textbox", { name: "Message the assistant" });
  await input.fill("Hello");
  await input.press("Enter");
  await expect(page.getByRole("link", { name: "Buy credits" })).toBeVisible();
});
