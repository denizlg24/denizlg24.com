import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, name: "Alice" | "Bob") {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Deniz Cloud" }).click();
  await page.getByRole("link", { name: `Continue as ${name}` }).click();
  await expect(
    page.getByRole("heading", { name: "What would you like to see?" }),
  ).toBeVisible();
}

test("OIDC with PKCE and signed ID token isolates workspaces and revokes the local session on sign-out", async ({
  page,
  browser,
}) => {
  const anonymous = await page.request.get("/api/workspace");
  expect(anonymous.status()).toBe(401);
  await signIn(page, "Alice");
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Watchlists" })
    .click();
  await page.getByRole("button", { name: "New watchlist" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Retirement ideas");
  await page.getByRole("button", { name: "Create watchlist" }).click();
  await expect(
    page.getByRole("heading", { name: "Retirement ideas" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add symbols" }).click();
  await page
    .getByRole("textbox", { name: "Ticker symbols" })
    .fill("SAP.DE, AAPL");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add symbols" })
    .click();
  await expect(
    page.getByRole("button", { name: "SAP.DE", exact: true }),
  ).toBeVisible({ timeout: 15000 });

  const alice = await (await page.request.get("/api/workspace")).json();
  expect(
    alice.data.watchlists.find(
      (item: { name: string }) => item.name === "Retirement ideas",
    ).symbols,
  ).toEqual(["SAP.DE", "AAPL"]);
  const bobContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3290",
  });
  const bob = await bobContext.newPage();
  await signIn(bob, "Bob");
  const bobWorkspace = await (await bob.request.get("/api/workspace")).json();
  expect(
    bobWorkspace.data.watchlists.map((item: { name: string }) => item.name),
  ).not.toContain("Retirement ideas");
  await bobContext.close();
  const settings = page
    .getByRole("navigation", { name: "Preferences" })
    .getByRole("link", { name: "Settings" });
  await settings.click();
  await expect(page.getByText("alice@example.test")).toBeVisible();
  const oldCookies = (await page.context().cookies()).filter(
    (item) => item.name === "stockwatcher",
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Continue with Deniz Cloud" }),
  ).toBeVisible();
  expect(oldCookies).toHaveLength(1);
  const old = oldCookies[0];
  expect(
    (
      await page.request.get("/api/workspace", {
        headers: { Cookie: `${old.name}=${old.value}` },
      })
    ).status(),
  ).toBe(401);
  await signIn(page, "Alice");
  const restored = await (await page.request.get("/api/workspace")).json();
  expect(restored.revision).toBe(2);
});

test("workspace writes reject foreign origins, stale revisions, and oversold trades", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open preview" }).click();
  const original = await (await page.request.get("/api/workspace")).json();
  expect(
    (
      await page.request.put("/api/workspace", {
        data: original,
        headers: { Origin: "https://example.test" },
      })
    ).status(),
  ).toBe(403);
  const headers = { Origin: "http://127.0.0.1:3290" };
  const bad = structuredClone(original);
  bad.data.books.push({ id: crypto.randomUUID(), name: "Test portfolio" });
  bad.data.trades.push({
    id: crypto.randomUUID(),
    bookId: bad.data.books[0].id,
    symbol: "AAPL",
    side: "sell",
    quantity: 1,
    price: 40,
    fees: 0,
    currency: "USD",
    date: "2026-10-05",
  });
  expect(
    (await page.request.put("/api/workspace", { data: bad, headers })).status(),
  ).toBe(400);
  expect(
    (
      await page.request.put("/api/workspace", { data: original, headers })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.put("/api/workspace", { data: original, headers })
    ).status(),
  ).toBe(409);
  const privileged = await page.request.post("/api/assistant", {
    data: { query: "Research Apple", web: true },
    headers,
  });
  expect(privileged.status()).toBe(503);
});

test("portfolio trades and notes can be recorded and assistant opens a prepared alert", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open preview" }).click();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Portfolio" })
    .click();
  await page.getByRole("button", { name: "New portfolio" }).click();
  await page
    .getByRole("textbox", { name: "Portfolio name" })
    .fill("Long-term holdings");
  await page.getByRole("button", { name: "Create portfolio" }).click();
  await page.getByRole("button", { name: "Record trade" }).click();
  await page.getByRole("textbox", { name: "Ticker" }).fill("AAPL");
  await page.getByRole("spinbutton", { name: "Shares" }).fill("2");
  await page
    .getByRole("spinbutton", { name: "Price per share" })
    .fill("125.50");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Record trade" })
    .click();
  await expect(page.getByRole("table").getByText("125.50")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Research" })
    .click();
  await page.getByRole("tab", { name: "Journal" }).click();
  await page.getByRole("button", { name: "New note" }).click();
  await page
    .getByRole("textbox", { name: "Title" })
    .fill("Follow annual results");
  await page
    .getByRole("textbox", { name: "Note" })
    .fill("Read the next annual filing.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Follow annual results" }),
  ).toBeVisible();
  await page
    .locator(".topbar-actions")
    .getByRole("button", { name: "Ask Stockwatcher" })
    .click();
  await page
    .getByRole("textbox", { name: "Request" })
    .fill("Alert me when AAPL goes below $100");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Target price" }),
  ).toHaveValue("100");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(page.getByRole("cell", { name: "Armed" })).toBeVisible();
});

test("requests build an empty dashboard in place, keep follow-up edits, and produce a shareable link", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open preview" }).click();
  await expect(
    page.getByRole("heading", { name: "What would you like to see?" }),
  ).toBeVisible();
  await expect(page.locator(".chart-panel")).toHaveCount(0);
  const initial = await (await page.request.get("/api/workspace")).json();
  expect(initial.data.watchlists).toEqual([]);
  expect(initial.data.books).toEqual([]);

  await page.getByRole("button", { name: "Magnificent 7" }).click();
  await expect(
    page.getByRole("heading", { name: "Magnificent Seven" }),
  ).toBeVisible({ timeout: 15000 });
  const map = page.locator(".map-panel");
  await expect(
    map.locator(".heat-tile").filter({ hasText: "TSLA" }),
  ).toBeVisible({ timeout: 15000 });
  const ask = async (text: string) => {
    await page.getByRole("textbox", { name: "Request" }).fill(text);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
  };
  await ask("now add the banks");
  await expect(
    map.locator(".heat-tile").filter({ hasText: "DBK.DE" }),
  ).toBeVisible({ timeout: 15000 });
  await ask("remove Tesla");
  await expect(page.getByText(/Removed TSLA/)).toBeVisible();
  await expect(
    map.locator(".heat-tile").filter({ hasText: "TSLA" }),
  ).toHaveCount(0);

  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 30);
  const date = start.toISOString().slice(0, 10);
  await ask(`show it since ${date}`);
  await expect(page.locator(".chart-since")).toContainText(date);
  await expect(map.getByText(`Since ${date}`, { exact: false })).toBeVisible();
  const href = await page
    .getByRole("link", { name: "Open dashboard" })
    .last()
    .getAttribute("href");
  expect(href).toContain("exclude");
  expect(href).toContain("TSLA");
  expect(href).toContain(date);
  // The latter two check the persisted dashboard, independently of URL parameters.
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace")).json()).data.dashboard
          ?.since,
    )
    .toBe(date);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Magnificent Seven" }),
  ).toBeVisible();
  const newContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3290",
  });
  const linked = await newContext.newPage();
  await linked.goto(`/${href}`);
  await linked.getByRole("link", { name: "Continue with Deniz Cloud" }).click();
  await linked.getByRole("link", { name: "Continue as Bob" }).click();
  await expect(linked.locator(".chart-since")).toContainText(date);
  await expect(
    linked.getByRole("heading", { name: "Magnificent Seven" }),
  ).toBeVisible();
  await newContext.close();
});
