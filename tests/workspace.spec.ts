import { expect, test, type Page } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const origin = { Origin: "http://127.0.0.1:3290" };

async function openPreview(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Open preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Desk", level: 1 }),
  ).toBeVisible();
}

async function seedThread(page: Page, title: string) {
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "stockwatcher",
  );
  const path = process.env.STOCKWATCHER_TEST_DB;
  if (!cookie || !path) throw new Error("No session or test database.");
  const db = new DatabaseSync(path);
  try {
    const row = db
      .prepare("SELECT user_json FROM sessions WHERE hash = ?")
      .get(createHash("sha256").update(cookie.value).digest("hex"));
    if (!row) throw new Error("Session not found.");
    const user: { id: string } = JSON.parse(String(row.user_json));
    const id = randomUUID();
    const messages = [
      { id: "m1", role: "user", parts: [{ type: "text", text: title }] },
    ];
    db.prepare(
      "INSERT INTO threads (user_id, id, title, messages, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(
      user.id,
      id,
      title,
      JSON.stringify(messages),
      new Date().toISOString(),
    );
    return id;
  } finally {
    db.close();
  }
}

async function signIn(page: Page, name: "Alice" | "Bob") {
  await page.goto("/");
  await page.getByRole("link", { name: "Continue with Deniz Cloud" }).click();
  await page.getByRole("link", { name: `Continue as ${name}` }).click();
  await expect(
    page.getByRole("heading", { name: "Desk", level: 1 }),
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
  const privileged = await page.request.post("/api/chat", {
    data: {
      id: "preview-thread",
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "Research Apple" }],
        },
      ],
    },
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
    page.getByRole("heading", { name: "Desk", level: 1 }),
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
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Markets" })
    .click();
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

test("the desk renders the default widgets and keeps added and removed widgets across reloads", async ({
  page,
}) => {
  await openPreview(page);
  const desk = page.locator(".desk-grid");
  for (const label of ["Holdings", "Movers", "Watchlist", "News", "Alerts"])
    await expect(
      desk.getByRole("heading", { name: label, exact: true, level: 2 }),
    ).toBeVisible();
  await expect(desk.locator(".desk-cell")).toHaveCount(6);
  expect(
    (await (await page.request.get("/api/workspace")).json()).data.desk,
  ).toBeUndefined();

  await page.getByRole("button", { name: "Edit desk" }).click();
  await page.getByRole("button", { name: "Add widget" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /^Note/ }).click();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Semis thesis");
  await dialog
    .getByRole("textbox", { name: "Note (markdown)" })
    .fill("Capex cycle still early.");
  await dialog.getByRole("button", { name: "Add note" }).click();
  await expect(dialog).toBeHidden();
  await expect(desk.locator(".desk-cell")).toHaveCount(7);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace")).json()).data.desk
          ?.widgets.length,
    )
    .toBe(7);

  await page.reload();
  await expect(desk.getByText("Capex cycle still early.")).toBeVisible();
  await expect(desk.locator(".desk-cell")).toHaveCount(7);

  await page.getByRole("button", { name: "Edit desk" }).click();
  await page.getByRole("button", { name: "Remove Note" }).click();
  await page.getByRole("button", { name: "Remove Alerts" }).click();
  await expect(desk.locator(".desk-cell")).toHaveCount(5);
  await page.getByRole("button", { name: "Done" }).click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/workspace")).json()).data.desk
          ?.widgets.length,
    )
    .toBe(5);
  await page.reload();
  await expect(desk.locator(".desk-cell")).toHaveCount(5);
  await expect(desk.getByText("Capex cycle still early.")).toHaveCount(0);
  await expect(
    desk.getByRole("heading", { name: "Alerts", exact: true }),
  ).toHaveCount(0);
});

test("memories can be created, edited and deleted from the memory panel and API", async ({
  page,
}) => {
  await openPreview(page);
  expect((await page.request.get("/api/memories")).status()).toBe(200);
  expect(
    (
      await page.request.post("/api/memories", {
        data: { kind: "thesis", content: "x" },
        headers: { Origin: "https://example.test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/memories", {
        data: { kind: "nonsense", content: "x" },
        headers: origin,
      })
    ).status(),
  ).toBe(400);

  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("link", { name: "Memory" })
    .click();
  const panel = page.getByRole("region", { name: "Assistant memory" });
  await expect(panel.getByText("Nothing remembered yet")).toBeVisible();
  await panel.getByRole("button", { name: "Add" }).click();
  await panel
    .getByRole("textbox", { name: "Memory" })
    .fill("Long ASML as an EUV monopoly");
  await panel.getByRole("textbox", { name: "Symbols" }).fill("asml.as");
  await panel.getByRole("button", { name: "Save memory" }).click();
  await expect(panel.getByText("Long ASML as an EUV monopoly")).toBeVisible();
  await expect(panel.getByText("ASML.AS", { exact: true })).toBeVisible();

  const listed = await (await page.request.get("/api/memories")).json();
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({
    kind: "thesis",
    content: "Long ASML as an EUV monopoly",
    symbols: ["ASML.AS"],
  });

  const viaApi = await page.request.post("/api/memories", {
    data: { kind: "preference", content: "Prefers EUR figures" },
    headers: origin,
  });
  expect(viaApi.status()).toBe(201);
  const created = await viaApi.json();
  const duplicate = await page.request.post("/api/memories", {
    data: { kind: "preference", content: "Prefers EUR figures" },
    headers: origin,
  });
  expect((await duplicate.json()).id).toBe(created.id);
  const patched = await page.request.patch(`/api/memories/${created.id}`, {
    data: { kind: "preference", content: "Prefers GBP figures" },
    headers: origin,
  });
  expect(patched.status()).toBe(200);
  expect((await patched.json()).content).toBe("Prefers GBP figures");

  await page.reload();
  await expect(panel.getByText("Prefers GBP figures")).toBeVisible();
  const item = panel
    .locator(".memory-item")
    .filter({ hasText: "Long ASML as an EUV monopoly" });
  await item.getByRole("button", { name: "Edit memory" }).click();
  await panel
    .getByRole("textbox", { name: "Memory" })
    .fill("Long ASML; trim above 30x forward");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    panel.getByText("Long ASML; trim above 30x forward"),
  ).toBeVisible();
  await panel
    .locator(".memory-item")
    .filter({ hasText: "Prefers GBP figures" })
    .getByRole("button", { name: "Delete memory" })
    .click();
  await expect(panel.getByText("Prefers GBP figures")).toHaveCount(0);
  await expect
    .poll(async () =>
      (await (await page.request.get("/api/memories")).json()).map(
        (memory: { content: string }) => memory.content,
      ),
    )
    .toEqual(["Long ASML; trim above 30x forward"]);
  expect(
    (
      await page.request.delete(`/api/memories/${created.id}`, {
        headers: origin,
      })
    ).status(),
  ).toBe(404);
});

test("the chat API answers 503 JSON without AI and the assistant falls back cleanly", async ({
  page,
}) => {
  const anonymous = await page.request.post("/api/chat", {
    data: { id: "t1", messages: [] },
    headers: origin,
  });
  expect(anonymous.status()).toBe(401);
  await openPreview(page);
  const response = await page.request.post("/api/chat", {
    data: {
      id: "fallback-thread",
      messages: [
        { id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] },
      ],
    },
    headers: origin,
  });
  expect(response.status()).toBe(503);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(typeof (await response.json()).error).toBe("string");
  await page
    .locator(".topbar-actions")
    .getByRole("button", { name: "Ask Stockwatcher" })
    .click();
  await expect(page.getByRole("textbox", { name: "Request" })).toBeVisible();
});

test("threads are private to the account that created them", async ({
  page,
  browser,
}) => {
  expect((await page.request.get("/api/threads")).status()).toBe(401);
  await signIn(page, "Alice");
  const id = await seedThread(page, "Alice's private thesis");
  const mine = await (await page.request.get("/api/threads")).json();
  expect(mine.map((thread: { id: string }) => thread.id)).toContain(id);
  expect((await page.request.get(`/api/threads/${id}`)).status()).toBe(200);

  const bobContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3290",
  });
  const bob = await bobContext.newPage();
  await signIn(bob, "Bob");
  const theirs = await (await bob.request.get("/api/threads")).json();
  expect(theirs.map((thread: { id: string }) => thread.id)).not.toContain(id);
  expect((await bob.request.get(`/api/threads/${id}`)).status()).toBe(404);
  expect(
    (
      await bob.request.delete(`/api/threads/${id}`, { headers: origin })
    ).status(),
  ).toBe(404);
  await bobContext.close();

  expect((await page.request.get(`/api/threads/${id}`)).status()).toBe(200);
  expect(
    (
      await page.request.delete(`/api/threads/${id}`, {
        headers: { Origin: "https://example.test" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.delete(`/api/threads/${id}`, { headers: origin })
    ).status(),
  ).toBe(200);
  expect((await page.request.get(`/api/threads/${id}`)).status()).toBe(404);
});
