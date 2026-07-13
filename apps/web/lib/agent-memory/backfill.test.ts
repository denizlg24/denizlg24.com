import { describe, expect, test } from "bun:test";
import {
  AGENT_MEMORY_BACKFILL_BATCH_SIZE,
  AGENT_MEMORY_BACKFILL_DOMAINS,
  parseBackfillCheckpoint,
} from "./backfill";

describe("agent memory backfill", () => {
  test("covers every wired canonical domain with bounded pages", () => {
    expect(AGENT_MEMORY_BACKFILL_DOMAINS).toEqual([
      "note",
      "calendar",
      "person",
      "project",
      "course",
      "journal",
      "email-triage",
    ]);
    expect(AGENT_MEMORY_BACKFILL_BATCH_SIZE).toBe(25);
  });

  test("validates and normalizes persisted checkpoints", () => {
    expect(
      parseBackfillCheckpoint({
        domain: "journal",
        cursor: "507f1f77bcf86cd799439011",
        processed: 12.8,
      }),
    ).toEqual({
      domain: "journal",
      cursor: "507f1f77bcf86cd799439011",
      processed: 12,
    });
    expect(() =>
      parseBackfillCheckpoint({ domain: "unknown", processed: 0 }),
    ).toThrow("invalid domain");
  });
});
