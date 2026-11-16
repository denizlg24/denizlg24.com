import { expect, test } from "bun:test";
import { incidentTextParts } from "./incident-text";

test("links the public postmortem without swallowing surrounding punctuation", () => {
  const url = "https://denizlg24.com/blog/november-2026-outage-postmortem";
  const text = `Read the postmortem: ${url}. Recovery is continuing.`;
  const parts = incidentTextParts(text);
  expect(parts.map((part) => part.text).join("")).toBe(text);
  expect(parts.filter((part) => part.href)).toEqual([{ text: url, href: url }]);
});

test("keeps non-web schemes, invalid URLs and credential-bearing URLs as text", () => {
  for (const text of [
    "javascript:alert(1)",
    "https://",
    "https://user:secret@example.com/",
  ]) {
    expect(incidentTextParts(text).every((part) => part.href === null)).toBe(
      true,
    );
  }
});
