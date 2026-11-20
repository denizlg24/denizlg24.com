import { expect, test } from "@playwright/test";

async function setup(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    let agents: any[] = JSON.parse(localStorage.getItem("test:agents") || "[]");
    (window as any).__finishChild = () => {
      agents = agents.map((a) => (a.parentId ? { ...a, status: "done" } : a));
    };
    (window as any).__stopRoots = () => {
      agents = agents.map((a) =>
        a.parentId ? a : { ...a, status: "stopped", activity: "CLI exited" },
      );
    };
    (window as any).__makeTerminalChild = () => {
      agents = agents.map((a) =>
        a.parentId ? { ...a, hasTerminal: true } : a,
      );
    };
    (window as any).__crowdCanvas = () => {
      const root = agents.find((a) => !a.parentId);
      agents = [
        root,
        ...Array.from({ length: 12 }, (_, n) => ({
          ...root,
          id: `branch-${n}`,
          parentId: n % 3 === 0 ? root.id : `branch-${n - 1}`,
          name: `Branch ${n}`,
          hasTerminal: true,
        })),
      ];
    };
    (window as any).__testGitReads = 0;
    (window as any).__testReads = [];
    (window as any).isTauri = true;
    (window as any).__testWrites = [];
    (window as any).__testLaunches = [];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        queueMicrotask(() =>
          localStorage.setItem("test:agents", JSON.stringify(agents)),
        );
        if (cmd === "git_changes") {
          (window as any).__testGitReads++;
          return {
            branch: "main",
            upstream: "origin/main",
            ahead: 2,
            behind: 0,
            files: [
              {
                path: "src/example.ts",
                oldPath: null,
                status: "M",
                staged: false,
                unstaged: true,
                additions: 1,
                deletions: 1,
              },
            ],
            filesTruncated: false,
            commits: [{ hash: "a1b2c3", subject: "Test commit", when: "now" }],
          };
        }
        if (cmd === "git_action") {
          (window as any).__testGitActions = [
            ...((window as any).__testGitActions ?? []),
            args.action,
          ];
          return "ok";
        }
        if (cmd === "git_file_diff")
          return {
            diff: "diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n@@ -1,2 +1,2 @@\n keep\n-const before = 1;\n+const after = 2;\n",
            binary: false,
            truncated: false,
          };
        if (cmd === "plugin:app|version") return "0.2.0";
        if (cmd === "plugin:updater|check")
          return (window as any).__testUpdate ?? null;
        if (cmd === "providers") return { codex: true, claude: true };
        if (cmd === "snapshot") {
          localStorage.setItem("test:agents", JSON.stringify(agents));
          return agents;
        }
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
        if (cmd === "read_terminal") {
          (window as any).__testReads.push(args);
          const data = args.after
            ? new Uint8Array()
            : new TextEncoder().encode("CLI ready\r\n");
          const page = new Uint8Array(9 + data.length);
          new DataView(page.buffer).setBigUint64(0, 1n, true);
          page.set(data, 9);
          return page.buffer;
        }
        if (cmd === "resume_agent") {
          agents = agents.map((a) =>
            a.id === args.id ? { ...a, status: "working" } : a,
          );
          (window as any).__testResumes = [
            ...((window as any).__testResumes ?? []),
            args.id,
          ];
          return agents.find((a) => a.id === args.id);
        }
        if (cmd === "rename_agent") {
          agents = agents.map((a) =>
            a.id === args.id ? { ...a, name: args.name } : a,
          );
          return;
        }
        if (cmd === "resize_terminal") return;
        if (cmd === "write_terminal") {
          (window as any).__testWrites.push(args.data);
          return;
        }
        if (cmd === "stop_agent") {
          const gone = new Set([args.id]);
          let size = 0;
          while (size !== gone.size) {
            size = gone.size;
            for (const a of agents) if (gone.has(a.parentId)) gone.add(a.id);
          }
          agents = agents.filter((a) => !gone.has(a.id));
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
    page.getByRole("menuitem", { name: "Open running terminals" }),
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
  await root.locator("summary").filter({ hasText: "Usage" }).click();
  await expect(root.getByLabel("Usage", { exact: true })).toContainText(
    "12% used",
  );
  await root.locator("summary").filter({ hasText: "Usage" }).click();
  await root.getByRole("button", { name: "Changes" }).click();
  const sidebar = page.getByRole("complementary", { name: "Git changes" });
  await expect(sidebar).toContainText("main");
  await expect(sidebar).toContainText("↑2");
  const file = sidebar.locator(".git-file").first();
  await expect(file).toHaveAttribute("aria-expanded", "false");
  await file.click();
  await expect(file).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.locator(".diff-del")).toContainText("const before = 1;");
  await expect(sidebar.locator(".diff-add")).toContainText("const after = 2;");
  await sidebar.getByText("Recent commits").click();
  await expect(sidebar).toContainText("Test commit");
  await page.screenshot({ path: "test-results/git-sidebar.png" });
  await sidebar.getByRole("button", { name: "Close Git sidebar" }).click();
  await expect(sidebar).toHaveCount(0);
  await root.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("hello");
  await expect
    .poll(() => page.evaluate(() => (window as any).__testWrites.join("")))
    .toBe("hello");
  await page
    .getByRole("button", { name: "Expand Scout" })
    .dispatchEvent("click");
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
  await page.mouse.move(before.x - 160, before.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await root.boundingBox())!.x)
    .toBeLessThan(before.x - 100);
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

test("terminal reopens at its saved cursor and windows survive reload", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/persisted");
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  const root = page.getByRole("region", { name: "Codex window", exact: true });
  await expect(root.getByLabel("Agent CLI terminal")).toBeVisible();
  await expect(root.locator(".xterm-rows")).toContainText("CLI ready");
  await expect
    .poll(() => page.evaluate(() => (window as any).__testReads.length))
    .toBeGreaterThan(1);
  await root.getByRole("button", { name: "Close Codex window" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("agents:terminal:root") || "null")
            ?.cursor,
      ),
    )
    .toBe(1);
  const screen = await page.evaluate(
    () => JSON.parse(localStorage.getItem("agents:terminal:root")!).screen,
  );
  expect(screen).toContain("CLI ready");
  await page.evaluate(() => {
    (window as any).__testReads = [];
  });
  await page
    .getByRole("button", { name: "Expand Codex", exact: true })
    .dispatchEvent("click");
  await expect
    .poll(() => page.evaluate(() => (window as any).__testReads[0]?.after))
    .toBe(1);
  await expect(root.getByLabel("Agent CLI terminal")).toBeVisible();
  await expect(root.locator(".xterm-rows")).toContainText("CLI ready");
  await page.reload();
  await expect(root.getByLabel("Agent CLI terminal")).toBeVisible();
  await expect(root.locator(".xterm-rows")).toContainText("CLI ready");
  await expect
    .poll(() => page.evaluate(() => (window as any).__testReads[0]?.after))
    .toBe(1);
  await page
    .getByRole("button", { name: "Expand Scout" })
    .dispatchEvent("click");
  await expect(
    page.getByRole("region", { name: "Scout window", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__finishChild());
  await expect(
    page.getByRole("region", { name: "Scout window", exact: true }),
  ).toHaveCount(0);
  await expect(root).toBeVisible();
  await expect(page.locator(".agent-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Show 1 finished" })
    .dispatchEvent("click");
  await expect(page.locator(".agent-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  const positions = await page
    .locator(".react-flow__node")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON()),
    );
  expect(positions).toHaveLength(2);
  const [a, b] = positions;
  expect(
    a.right <= b.left ||
      b.right <= a.left ||
      a.bottom <= b.top ||
      b.bottom <= a.top,
  ).toBeTruthy();
});

test("managed subagents expose interactive terminals and close when complete", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/managed-child");
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  await expect(page.locator(".agent-card")).toHaveCount(2);
  await page.evaluate(() => (window as any).__makeTerminalChild());
  await page
    .getByRole("button", { name: "Expand Scout" })
    .dispatchEvent("click");
  const child = page.getByRole("region", { name: "Scout window", exact: true });
  await expect(child.getByLabel("Agent CLI terminal")).toBeVisible();
  await expect(child.locator(".transcript")).toHaveCount(0);
  await page.screenshot({ path: "test-results/managed-terminal.png" });
  await child.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("child input");
  await expect
    .poll(() => page.evaluate(() => (window as any).__testWrites.join("")))
    .toBe("child input");
  await page.evaluate(() => (window as any).__finishChild());
  await expect(child).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show 1 finished" })
    .dispatchEvent("click");
  await page
    .getByRole("button", { name: "Expand Scout" })
    .dispatchEvent("click");
  await expect(child.getByLabel("Agent CLI terminal")).toBeVisible();
  await page.waitForTimeout(800);
  await expect(child).toBeVisible();
  await page.reload();
  await expect(child.getByLabel("Agent CLI terminal")).toBeVisible();
  await expect(child.locator(".xterm-rows")).toContainText("CLI ready");
  await expect(child).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Codex window", exact: true }),
  ).toBeVisible();
});

test("crowded agent trees arrange without overlapping cards", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/crowded");
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  await page.evaluate(() => (window as any).__crowdCanvas());
  await expect(page.locator(".agent-card")).toHaveCount(13);
  await page.getByRole("button", { name: "Close Codex window" }).click();
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await page.waitForTimeout(350);
  const boxes = await page
    .locator(".agent-card")
    .evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().toJSON()),
    );
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      expect(
        a.right <= b.left ||
          b.right <= a.left ||
          a.bottom <= b.top ||
          b.bottom <= a.top,
      ).toBeTruthy();
    }
  await page.screenshot({ path: "test-results/arranged-trees.png" });
});

test("Git inspections only run while the sidebar is open", async ({ page }) => {
  await setup(page);
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/git-polling");
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  const root = page.getByRole("region", { name: "Codex window", exact: true });
  await expect(root.getByLabel("Agent CLI terminal")).toBeVisible();
  await page.clock.install();
  await page.clock.fastForward(6000);
  expect(await page.evaluate(() => (window as any).__testGitReads)).toBe(0);
  const reads = () => page.evaluate(() => (window as any).__testGitReads);
  const git = root.getByRole("button", { name: "Changes" });
  await git.click();
  await expect.poll(reads).toBeGreaterThan(0);
  const opened = await reads();
  await page.clock.fastForward(4500);
  await expect.poll(reads).toBeGreaterThan(opened);
  await git.click();
  await expect(git).toHaveAttribute("aria-pressed", "false");
  const closed = await reads();
  await page.clock.fastForward(12000);
  expect(await reads()).toBe(closed);
  await git.focus();
  await page.keyboard.press("Enter");
  await expect.poll(reads).toBeGreaterThan(closed);
});

test("storage quota failures keep canvas interactions usable", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("agents:"))
        throw new DOMException(
          "Test storage quota exhausted",
          "QuotaExceededError",
        );
      original.call(this, key, value);
    };
  });
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/storage-failure");
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  const root = page.getByRole("region", { name: "Codex window", exact: true });
  await expect(root.getByLabel("Agent CLI terminal")).toBeVisible();
  await expect(page.locator(".notice.error")).toContainText("Could not save");
  await page.getByRole("button", { name: "Arrange", exact: true }).click();
  await root.getByRole("button", { name: "Maximize window" }).click();
  await expect(root).toHaveClass(/maximized/);
  await root.getByRole("button", { name: "Restore window" }).click();
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await root.getByRole("button", { name: "Close Codex window" }).click();
  await page
    .getByRole("button", { name: "Expand Codex", exact: true })
    .dispatchEvent("click");
  await expect(root.getByLabel("Agent CLI terminal")).toBeVisible();
  await expect(page.locator(".agent-card")).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("shows the running version and offers available updates", async ({
  page,
}) => {
  await page.clock.install();
  await setup(page);
  await page.evaluate(() => {
    (window as any).__testUpdate = {
      rid: 1,
      currentVersion: "0.2.0",
      version: "0.3.0",
      rawJson: {},
    };
  });
  await expect(page.getByRole("button", { name: "v0.2.0" })).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(
    page.getByRole("status").filter({ hasText: "0.3.0" }),
  ).toContainText("Agents 0.3.0 is available.");
  await page.getByRole("button", { name: "Dismiss update notice" }).click();
  await expect(page.getByText("Agents 0.3.0 is available.")).toHaveCount(0);
});

test("cards rename and resume from their menu, and windows tile", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/menu");
  await page.getByRole("checkbox", { name: /Native subagents/ }).check();
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__testLaunches[0]?.options.nativeSubagents,
      ),
    )
    .toBe(true);
  await page.locator(".agent-card").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename…" }).click();
  await page.getByLabel("Agent name").fill("Refactor");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator(".agent-card h2").first()).toHaveText("Refactor");
  await page.getByRole("button", { name: "Close Refactor window" }).click();
  await page.evaluate(() => (window as any).__finishChild());
  await expect(page.getByRole("button", { name: "Expand Scout" })).toHaveCount(
    0,
  );
  await page.evaluate(() => (window as any).__stopRoots());
  await page
    .getByRole("button", { name: "Expand Refactor" })
    .dispatchEvent("click");
  const refactor = page.getByRole("region", { name: "Refactor window" });
  await refactor.getByRole("button", { name: "Resume" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__testResumes))
    .toEqual(["root"]);
  await expect(refactor.getByRole("button", { name: "Stop" })).toBeVisible();
  await page
    .getByRole("button", { name: "Show 1 finished" })
    .dispatchEvent("click");
  await page
    .getByRole("button", { name: "Expand Scout" })
    .dispatchEvent("click");
  await expect(page.locator(".agent-window")).toHaveCount(2);
  await page.getByRole("button", { name: "Tile", exact: true }).click();
  const boxes = await page
    .locator(".agent-window")
    .evaluateAll((w) => w.map((e) => e.getBoundingClientRect().toJSON()));
  const [a, b] = boxes;
  expect(a.right <= b.left || b.right <= a.left).toBeTruthy();
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  const left = page.locator(".agent-window").first().locator(".edge-w");
  const before = await page.locator(".agent-window").first().boundingBox();
  const handle = await left.boundingBox();
  if (!before || !handle) throw Error("window missing");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 40);
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await page.locator(".agent-window").first().boundingBox())!.width,
    )
    .toBeLessThan(before.width - 40);
  await page.getByRole("button", { name: "Close Scout tab" }).click();
  await expect(page.locator(".agent-window")).toHaveCount(1);
  await page.screenshot({ path: "test-results/tiled-windows.png" });
});

test("recent directories are offered on the next launch", async ({ page }) => {
  await setup(page);
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page.getByLabel("Working directory").fill("/tmp/recent-project");
  await page.getByRole("button", { name: "Launch agent", exact: true }).click();
  await expect(page.locator(".agent-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "New agent", exact: true })
    .first()
    .click();
  await page
    .getByRole("group", { name: "Recent directories" })
    .getByRole("button", { name: "recent-project" })
    .click();
  await expect(page.getByLabel("Working directory")).toHaveValue(
    "/tmp/recent-project",
  );
});

test("threads sidebar groups by directory and drives the changes panel", async ({
  page,
}) => {
  await setup(page);
  for (const dir of ["/tmp/alpha", "/tmp/beta"]) {
    await page
      .getByRole("button", { name: "New agent", exact: true })
      .first()
      .click();
    await page.getByLabel("Working directory").fill(dir);
    await page
      .getByRole("button", { name: "Launch agent", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  const threads = page.getByRole("navigation", { name: "Threads" });
  await expect(threads.getByRole("button", { name: "alpha" })).toBeVisible();
  await expect(threads.getByRole("button", { name: "beta" })).toBeVisible();
  await expect(threads.getByRole("button", { name: /^Thread / })).toHaveCount(
    4,
  );
  await threads.getByLabel("Search threads").fill("beta");
  await expect(threads.getByRole("button", { name: /^Thread / })).toHaveCount(
    2,
  );
  await threads.getByLabel("Search threads").fill("");
  await threads.getByRole("button", { name: "alpha" }).click();
  await expect(threads.getByRole("button", { name: /^Thread / })).toHaveCount(
    2,
  );
  await page
    .getByRole("button", { name: "Changes", exact: true })
    .first()
    .click();
  const panel = page.getByRole("complementary", { name: "Git changes" });
  await expect(panel).toContainText("main");
  await panel.getByRole("button", { name: "Stage example.ts" }).click();
  await panel.getByLabel("Commit message").fill("Ship it");
  await expect
    .poll(() => page.evaluate(() => (window as any).__testGitActions))
    .toEqual([{ kind: "stage", paths: ["src/example.ts"] }]);
  const before = await panel.boundingBox();
  const grip = await panel
    .getByRole("separator", { name: "Resize changes panel" })
    .boundingBox();
  if (!before || !grip) throw Error("panel missing");
  await page.mouse.move(grip.x + 3, grip.y + 200);
  await page.mouse.down();
  await page.mouse.move(grip.x - 120, grip.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThan(before.width + 100);
  await page.screenshot({ path: "test-results/threads-and-changes.png" });
});
