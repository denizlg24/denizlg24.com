import { expect, test } from "bun:test";
import { parseApeWisdom } from "./wsb";

const body = {
  count: 538,
  pages: 6,
  current_page: 1,
  results: [
    {
      rank: 1,
      ticker: "NVDA",
      name: "NVIDIA",
      mentions: 286,
      upvotes: 570,
      rank_24h_ago: 1,
      mentions_24h_ago: 135,
    },
    {
      rank: "2",
      ticker: "spy",
      name: "SPDR S&amp;P 500 ETF Trust",
      mentions: "159",
      upvotes: 619,
      rank_24h_ago: null,
      mentions_24h_ago: null,
    },
  ],
};

test("parses ApeWisdom results into snapshot rows", () => {
  expect(parseApeWisdom(body, "wallstreetbets")).toEqual([
    {
      filter: "wallstreetbets",
      ticker: "NVDA",
      rank: 1,
      mentions: 286,
      upvotes: 570,
      rank24hAgo: 1,
      mentions24hAgo: 135,
    },
    {
      filter: "wallstreetbets",
      ticker: "SPY",
      rank: 2,
      mentions: 159,
      upvotes: 619,
      rank24hAgo: null,
      mentions24hAgo: null,
    },
  ]);
});

test("rejects a body without results", () => {
  expect(() => parseApeWisdom({ error: "nope" }, "all-stocks")).toThrow();
});
