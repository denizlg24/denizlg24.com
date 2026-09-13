import { expect, test } from "bun:test";
import { SERVER_INSTRUCTIONS } from "./instructions";
import { createClient, recordingUpstream } from "./tools/harness.test-util";

test("every tool the instructions name is registered", async () => {
  const { upstream } = recordingUpstream();
  const registered = new Set(
    (await createClient(upstream).listTools()).map((tool) => tool.name),
  );
  const named = new Set(
    SERVER_INSTRUCTIONS.match(/\b(?:web|forge|cloud|storage)_[a-z0-9_]+/g),
  );
  expect(named.size).toBeGreaterThan(10);
  expect([...named].filter((name) => !registered.has(name))).toEqual([]);
});
