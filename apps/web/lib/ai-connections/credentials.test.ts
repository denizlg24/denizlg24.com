import { expect, test } from "bun:test";

// Bun module mocks are shared across test files. Run the real encryption and
// Mongo refresh scenarios in fresh processes so facade mocks cannot replace
// the credential implementation or leak fake database models into other suites.
for (const file of [
  "lib/ai-connections/connections.cases.ts",
  "lib/ai-subscriptions/subscriptions.cases.ts",
]) {
  test(`isolated credential scenarios: ${file}`, async () => {
    const child = Bun.spawn([process.execPath, "test", `./${file}`], {
      cwd: new URL("../../", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  }, 60_000);
}
