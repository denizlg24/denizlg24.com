import { expect, test } from "@playwright/test";

async function setup(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    let agents: any[] = [];
    (window as any).isTauri = true;
    (window as any).__testWrites = [];
    (window as any).__testLaunches = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        if (cmd === "providers") return { codex: true, claude: true };
        if (cmd === "snapshot") return agents;
        if (cmd === "available_models")
          return [
            {
              id: args.provider === "codex" ? "test-codex" : "opus",
              label: "Available model",
              reasoning: ["low", "high", "xhigh"],
            },
          ];
        if (cmd === "plugin:dialog|open") return "/tmp/canvas-project";
        if (cmd === "create_agent") {
          (window as any).__testLaunches.push(args);
          const id = agents.some((a) => a.id === "root") ? "root2" : "root";
          const root = {
            id,
            rootId: id,
            settings: args.options,
            parentId: null,
            sessionId: "session",
            provider: args.provider,
            name: args.provider === "codex" ? "Codex" : "Claude",
            cwd: args.cwd,
            status: "working",
            activity: "Running tests",
            inputTokens: 1200,
            outputTokens: 300,
            cachedTokens: 600,
            contextTokens: 1400,
            contextWindow: 200000,
            cost: null,
            rateLimits: { primary: { used_percent: 12, window_minutes: 300 } },
            transcript: "",
            telemetryError: null,
          };
          agents = [
            ...agents,
            root,
            {
              ...root,
              id: `${id}:child`,
              parentId: id,
              name: "Scout",
              activity: "Reading source files",
              transcript: "Found the entry point.",
              inputTokens: 500,
              outputTokens: 100,
            },
          ];
          return root;
        }
        if (cmd === "read_terminal")
          return {
            chunks: args.after
              ? []
              : [Array.from(new TextEncoder().encode("CLI ready\r\n"))],
            cursor: 1,
            truncated: false,
          };
        if (cmd === "write_terminal") {
          (window as any).__testWrites.push(args.data);
          return;
        }
        if (cmd === "stop_agent") {
          agents = agents.filter((a) => a.rootId !== args.id);
          return;
        }
      },
    };
  });
  await page.goto("/");
}
test("launch configuration, floating terminals, resize, and stop removes descendants", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await expect(page.getByRole("heading", { name: "No agents" })).toBeVisible();
  await page
    .locator(".canvas")
    .click({ button: "right", position: { x: 200, y: 200 } });
  await expect(
    page.getByRole("menuitem", { name: "Open all terminals" }),
  ).toBeDisabled();
  await page.getByRole("menuitem", { name: "New Claude agent" }).click();
  await page.getByRole("button", { name: "Choose", exact: true }).click();
  await page.getByLabel("Model", { exact: true }).fill("opus");
  await page.getByLabel("Reasoning", { exact: true }).selectOption("high");
  await page.getByRole("radio", { name: "Bypass permissions" }).check();
  await page.screenshot({ path: "test-results/launch-screen.png" });
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__testLaunches[0]?.options))
    .toEqual({ model: "opus", reasoning: "high", permissions: "bypass" });
  await expect(page.locator(".agent-card")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  const root = page.getByRole("region", { name: "Claude window", exact: true });
  await expect(root.getByLabel("Agent CLI terminal")).toBeVisible();
  await root.locator("summary").click();
  await expect(root.getByLabel("Usage", { exact: true })).toContainText(
    "12% used",
  );
  await root.locator("summary").click();
  await root.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("hello");
  await expect
    .poll(() => page.evaluate(() => (window as any).__testWrites.join("")))
    .toBe("hello");
  await page.getByRole("button", { name: "Expand Scout" }).click();
  await expect(page.locator(".agent-window")).toHaveCount(2);
  const child = page.getByRole("region", { name: "Scout window", exact: true });
  await expect(child.locator(".transcript")).toHaveText(
    "Found the entry point.",
  );
  await child.getByRole("button", { name: "Parent terminal" }).click();
  await expect(page.locator(".agent-window")).toHaveCount(2);
  const before = await root.boundingBox();
  if (!before) throw Error("window missing");
  await page.mouse.move(before.x + 100, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 260, before.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await root.boundingBox())!.x)
    .toBeGreaterThan(before.x + 100);
  const moved = await root.boundingBox();
  if (!moved) throw Error("window missing");
  const grip = await root
    .getByRole("button", { name: "Resize Claude window" })
    .boundingBox();
  if (!grip) throw Error("resize missing");
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + 100, grip.y + 50, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => (await root.boundingBox())!.width)
    .toBeGreaterThan(moved.width + 50);
  await page.getByRole("button", { name: "Use dark theme" }).click();
  const titleColor = await root
    .locator(".window-titlebar strong")
    .evaluate((e) => getComputedStyle(e).color);
  await expect
    .poll(() =>
      root
        .getByRole("button", { name: "Stop", exact: true })
        .evaluate((e) => getComputedStyle(e).color),
    )
    .toBe(titleColor);
  await page.screenshot({ path: "test-results/floating-windows.png" });
  const bounds = await root.boundingBox();
  const terminal = await root.locator(".terminal-host").boundingBox();
  const screen = await root.locator(".xterm-screen").boundingBox();
  if (!bounds || !terminal || !screen) throw Error("terminal missing");
  expect(terminal.y).toBeGreaterThan(bounds.y + 44);
  expect(screen.y + screen.height).toBeLessThanOrEqual(
    bounds.y + bounds.height - 10,
  );
  await root.getByRole("button", { name: "Maximize window" }).click();
  await expect(root).toHaveClass(/maximized/);
  await root.getByRole("button", { name: "Restore window" }).click();
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/second");
  await page.getByLabel("Model", { exact: true }).fill("test-codex");
  await page.getByLabel("Reasoning", { exact: true }).selectOption("xhigh");
  await page.getByRole("radio", { name: "YOLO" }).check();
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  await expect(page.locator(".agent-card")).toHaveCount(4);
  await expect(
    page.getByRole("region", { name: "Codex window", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Focus Claude window", exact: true })
    .click();
  await root.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(root).toHaveCount(0);
  await expect(child).toHaveCount(0);
  await expect(page.locator(".agent-card")).toHaveCount(2);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page
    .getByRole("region", { name: "Codex window", exact: true })
    .getByRole("button", { name: "Stop", exact: true })
    .click();
  await expect(page.locator(".agent-card")).toHaveCount(0);
  await expect(page.locator(".agent-window")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "No agents" })).toBeVisible();
  expect(errors).toEqual([]);
});
test("keyboard launch at compact desktop size", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/project");
  await page.getByLabel("Working directory").press("Enter");
  await expect(page.getByLabel("Agent CLI terminal")).toBeVisible();
  await page.screenshot({ path: "test-results/compact-window.png" });
});
