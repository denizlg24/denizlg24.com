import { describe, expect, test } from "bun:test";
import { buildRetrievalQuery, SUMMARY_MAX_CHARS } from "./query-context";

describe("agent memory retrieval query", () => {
  test("uses the latest message alone when no summary exists", () => {
    expect(
      buildRetrievalQuery({ latestMessage: "  what is due this week?  " }),
    ).toBe("what is due this week?");
    expect(
      buildRetrievalQuery({ latestMessage: "hi", rollingSummary: "   " }),
    ).toBe("hi");
  });

  test("prepends the rolling summary with the message last", () => {
    const query = buildRetrievalQuery({
      latestMessage: "yes, do that one",
      rollingSummary: "Admin is planning the LX-2026 course schedule.",
    });
    expect(query).toBe(
      "Admin is planning the LX-2026 course schedule.\n\nyes, do that one",
    );
  });

  test("caps oversized summaries and keeps empty messages empty", () => {
    const query = buildRetrievalQuery({
      latestMessage: "ok",
      rollingSummary: "s".repeat(SUMMARY_MAX_CHARS * 2),
    });
    expect(query.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 4);
    expect(
      buildRetrievalQuery({ latestMessage: "   ", rollingSummary: "topic" }),
    ).toBe("");
  });
});
