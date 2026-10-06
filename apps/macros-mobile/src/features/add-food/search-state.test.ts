import { describe, expect, test } from "bun:test";
import { type ServerSearch, serverResults } from "./search-state";

type Item = { name: string; brand?: string | null };

const items: Item[] = [
  { name: "Banana" },
  { name: "Banana bread", brand: "Lidl" },
  { name: "Bagel" },
];

function search(overrides: Partial<ServerSearch<Item>>): ServerSearch<Item> {
  return {
    query: "ba",
    debounced: "ba",
    items,
    isPlaceholderData: false,
    isFetching: false,
    paused: false,
    ...overrides,
  };
}

const names = (list: Item[]) => list.map((item) => item.name);

describe("serverResults", () => {
  test("shows every result once the server has answered the field", () => {
    const state = serverResults(search({}));
    expect(names(state.results)).toEqual(["Banana", "Banana bread", "Bagel"]);
    expect(state.awaiting).toBe(false);
    expect(state.settled).toBe(true);
  });

  test("while debouncing, keeps only previous results that match the field", () => {
    const state = serverResults(search({ query: "ban", debounced: "ba" }));
    expect(names(state.results)).toEqual(["Banana", "Banana bread"]);
    expect(state.awaiting).toBe(true);
    expect(state.settled).toBe(false);
  });

  test("matches on brand as well as name, ignoring case", () => {
    const state = serverResults(search({ query: "LID", debounced: "ba" }));
    expect(names(state.results)).toEqual(["Banana bread"]);
  });

  test("a trailing space does not count as debouncing", () => {
    const state = serverResults(search({ query: "ba ", debounced: "ba" }));
    expect(state.awaiting).toBe(false);
    expect(state.settled).toBe(true);
  });

  test("the first keystroke waits with nothing to show", () => {
    const state = serverResults(
      search({ query: "b", debounced: "", items: undefined }),
    );
    expect(state.results).toEqual([]);
    expect(state.awaiting).toBe(true);
    expect(state.settled).toBe(false);
  });

  test("while the debounced query is in flight, previous results are filtered", () => {
    const state = serverResults(
      search({
        query: "bag",
        debounced: "bag",
        isPlaceholderData: true,
        isFetching: true,
      }),
    );
    expect(names(state.results)).toEqual(["Bagel"]);
    expect(state.awaiting).toBe(true);
    expect(state.settled).toBe(false);
  });

  test("paused offline, placeholder results are never shown as this query's answer", () => {
    const state = serverResults(
      search({
        query: "bag",
        debounced: "bag",
        isPlaceholderData: true,
        isFetching: true,
        paused: true,
      }),
    );
    expect(state.results).toEqual([]);
    expect(state.awaiting).toBe(false);
    expect(state.settled).toBe(false);
  });

  test("a refused query hides the placeholder results", () => {
    const state = serverResults(
      search({ query: "bag", debounced: "bag", isPlaceholderData: true }),
    );
    expect(state.results).toEqual([]);
    expect(state.awaiting).toBe(false);
  });
});
