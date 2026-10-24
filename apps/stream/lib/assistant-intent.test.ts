import { expect, test } from "bun:test";
import { assistantIntentSchema } from "@repo/schemas/stream";

import { EMPTY_INTENT, fallbackIntent } from "@/lib/assistant-intent";

test("without the model, the prompt's distinctive words become plot keywords", () => {
  const intent = fallbackIntent(
    "Something about a heist, like a really clever HEIST movie in Paris",
  );
  expect(intent.keywords).toEqual(["heist", "clever", "paris"]);
  expect(fallbackIntent("a film to watch")).toEqual(EMPTY_INTENT);
  expect(assistantIntentSchema.parse(intent)).toEqual(intent);
});

test("the fallback stays within what the intent contract allows", () => {
  const intent = fallbackIntent(
    `${"x".repeat(80)} one two three four five six seven eight nine ten eleven twelve`,
  );
  expect(intent.keywords.length).toBeLessThanOrEqual(8);
  expect(() => assistantIntentSchema.parse(intent)).not.toThrow();
});
