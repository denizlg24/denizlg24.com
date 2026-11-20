import { expect, test } from "@playwright/test";

const headers = { Origin: "http://127.0.0.1:3290" };
const token = "1111111111111111111111";

test("Interactive Brokers rejects bad credentials without saving a link", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open preview" }).click();
  const malformed = await page.request.post("/api/brokers/ibkr", {
    data: { token: "abc", queryId: "424242" },
    headers,
  });
  expect(malformed.status()).toBe(400);
  const expired = await page.request.post("/api/brokers/ibkr", {
    data: { token: "9999999999999999999999", queryId: "424242" },
    headers,
  });
  expect(expired.status()).toBe(422);
  expect((await expired.json()).result).toMatchObject({
    ok: false,
    relink: true,
    error: "Token has expired.",
  });
  expect(
    (await (await page.request.get("/api/brokers/ibkr")).json()).link,
  ).toBeNull();
  const foreign = await page.request.post("/api/brokers/ibkr", {
    data: { token, queryId: "424242" },
    headers: { Origin: "https://example.test" },
  });
  expect(foreign.status()).toBe(403);
});

test("connecting Interactive Brokers syncs a read-only portfolio the client cannot tamper with", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open preview" }).click();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Portfolio" })
    .click();
  await page
    .getByRole("button", { name: "Connect Interactive Brokers" })
    .click();
  await page.getByLabel("Query ID").fill("424242");
  await page.getByLabel("Flex token").fill(token);
  await page.getByRole("button", { name: "Connect and sync" }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 30_000 });

  await expect(
    page.getByRole("heading", { name: "Interactive Brokers U7654321" }),
  ).toBeVisible();
  await expect(page.getByText(/synced just now/)).toBeVisible();
  await expect(
    page.getByText(/Not tracked:.*OPT positions.*short position/),
  ).toBeVisible();
  await expect(page.getByText(/USD 4,200\.50/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record trade" })).toHaveCount(
    0,
  );

  const { revision, data } = await (
    await page.request.get("/api/workspace")
  ).json();
  const book = data.books.find(
    (item: { broker?: { account: string } }) =>
      item.broker?.account === "U7654321",
  );
  expect(book.broker).toMatchObject({ provider: "ibkr", asOf: "2026-11-19" });
  const synced = data.trades
    .filter((trade: { bookId: string }) => trade.bookId === book.id)
    .map(
      ({
        symbol,
        quantity,
        price,
        currency,
        date,
      }: Record<string, unknown>) => ({
        symbol,
        quantity,
        price,
        currency,
        date,
      }),
    )
    .sort(
      (
        a: { symbol: string; date: string },
        b: { symbol: string; date: string },
      ) => `${a.symbol}${a.date}`.localeCompare(`${b.symbol}${b.date}`),
    );
  expect(synced).toEqual([
    {
      symbol: "AAPL",
      quantity: 10,
      price: 150.5,
      currency: "USD",
      date: "2026-11-19",
    },
    {
      symbol: "BRK-B",
      quantity: 3,
      price: 400,
      currency: "USD",
      date: "2026-11-19",
    },
    {
      symbol: "VOD.L",
      quantity: 600,
      price: 60,
      currency: "GBp",
      date: "2024-03-01",
    },
    {
      symbol: "VOD.L",
      quantity: 400,
      price: 85,
      currency: "GBp",
      date: "2025-06-10",
    },
  ]);

  const tampered = structuredClone(data);
  tampered.trades = tampered.trades.filter(
    (trade: { bookId: string }) => trade.bookId !== book.id,
  );
  tampered.books = tampered.books.map((item: { id: string }) =>
    item.id === book.id
      ? {
          id: book.id,
          name: "Renamed IBKR",
          broker: { ...book.broker, account: "U0000000" },
        }
      : item,
  );
  const saved = await page.request.put("/api/workspace", {
    data: { revision, data: tampered },
    headers,
  });
  expect(saved.status()).toBe(200);
  const after = (await saved.json()).data;
  const kept = after.books.find((item: { id: string }) => item.id === book.id);
  expect(kept.name).toBe("Renamed IBKR");
  expect(kept.broker.account).toBe("U7654321");
  expect(
    after.trades.filter(
      (trade: { bookId: string }) => trade.bookId === book.id,
    ),
  ).toHaveLength(4);

  const resync = await page.request.post("/api/brokers/ibkr", { headers });
  expect(resync.status()).toBe(200);
  const resynced = await (await page.request.get("/api/workspace")).json();
  expect(
    resynced.data.books.find((item: { id: string }) => item.id === book.id)
      .name,
  ).toBe("Renamed IBKR");
  expect(
    resynced.data.trades.filter(
      (trade: { bookId: string }) => trade.bookId === book.id,
    ),
  ).toHaveLength(4);

  await page.reload();
  await page
    .getByRole("button", { name: "Disconnect Interactive Brokers" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Disconnect" })
    .click();
  await expect(
    page.getByRole("button", { name: "Connect Interactive Brokers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Renamed IBKR" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Record trade" }),
  ).toBeVisible();
});
