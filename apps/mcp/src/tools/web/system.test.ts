import { beforeEach, describe, expect, test } from "bun:test";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import {
  createClient,
  type RecordedCall,
  recordingUpstream,
} from "../harness.test-util";
import { registerWebAgentMemory } from "./agent-memory";
import { registerWebAuthenticator } from "./authenticator";
import { registerWebFinance } from "./finance";
import { registerWebMarkets } from "./markets";
import { registerWebMisc } from "./misc";
import { registerWebSemantic } from "./semantic";

const register: ToolRegistrar = (server, upstream) => {
  const api = createApi(upstream);
  registerWebAgentMemory(server, api);
  registerWebMarkets(server, api);
  registerWebFinance(server, api);
  registerWebSemantic(server, api);
  registerWebMisc(server, api);
  registerWebAuthenticator(server, api);
};

const { upstream, calls } = recordingUpstream();
const client = createClient(upstream, register);

function last(): RecordedCall {
  const call = calls.at(-1);
  if (!call) throw new Error("no upstream call recorded");
  return call;
}

function json(call: RecordedCall): unknown {
  return call.body === null ? null : JSON.parse(call.body);
}

beforeEach(() => {
  calls.length = 0;
});

describe("system tool catalogue", () => {
  test("registers exactly the system tools", async () => {
    const names = (await client.listTools()).map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        "web_agent_memory",
        "web_agent_memory_candidates",
        "web_agent_memory_memories",
        "web_agent_memory_evidence",
        "web_agent_memory_goals",
        "web_agent_memory_insights",
        "web_agent_memory_procedures",
        "web_agent_memory_reflection",
        "web_agent_memory_resource_suggestions",
        "web_agent_memory_retrieval_traces",
        "web_agent_memory_settings",
        "web_markets_portfolios",
        "web_markets_orders",
        "web_markets_trades",
        "web_markets_symbols",
        "web_markets_watchlists",
        "web_finance",
        "web_finance_accounts",
        "web_finance_categories",
        "web_finance_entries",
        "web_finance_rules",
        "web_finance_budget",
        "web_finance_envelopes",
        "web_semantic",
        "web_dashboard_stats",
        "web_settings",
        "web_now_page",
        "web_revalidate",
        "web_upload",
        "web_instagram_token",
        "web_api_keys",
        "web_authenticator",
      ].sort(),
    );
  });
});

describe("web_agent_memory", () => {
  test("overview passes list filters as query", async () => {
    await client.call("web_agent_memory", {
      action: "overview",
      limit: 20,
      status: "archived",
      candidateStatus: "accepted",
      memorySort: "recent",
      memoryType: "semantic",
      memoryCursor: "abc",
    });
    expect(last().method).toBe("GET");
    expect(last().path).toBe(
      "/api/admin/agent-memory?limit=20&status=archived&candidateStatus=accepted&memorySort=recent&memoryType=semantic&memoryCursor=abc",
    );
  });

  test("audit, graph, contradictions", async () => {
    await client.call("web_agent_memory", { action: "audit", limit: 5 });
    expect(last().path).toBe("/api/admin/agent-memory/audit?limit=5");
    await client.call("web_agent_memory", { action: "graph" });
    expect(last().path).toBe("/api/admin/agent-memory/graph");
    await client.call("web_agent_memory", {
      action: "contradictions",
      page: 3,
    });
    expect(last().path).toBe("/api/admin/agent-memory/contradictions?page=3");
  });

  test("explore, backfill, user_model_rollback post bodies", async () => {
    await client.call("web_agent_memory", { action: "explore", query: "rust" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-memory/explore");
    expect(json(last())).toEqual({ query: "rust" });
    await client.call("web_agent_memory", { action: "backfill" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-memory/backfill");
    await client.call("web_agent_memory", {
      action: "user_model_rollback",
      targetRevision: 3,
      reason: "bad merge",
    });
    expect(last().path).toBe("/api/admin/agent-memory/user-model/rollback");
    expect(json(last())).toEqual({ targetRevision: 3, reason: "bad merge" });
  });
});

describe("web_agent_memory_candidates", () => {
  test("decide posts the decision to the candidate", async () => {
    await client.call("web_agent_memory_candidates", {
      action: "decide",
      id: "c/1",
      decision: { action: "accept", reason: "true" },
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-memory/candidates/c%2F1");
    expect(json(last())).toEqual({ action: "accept", reason: "true" });
  });

  test("bulk posts ids and action", async () => {
    await client.call("web_agent_memory_candidates", {
      action: "bulk",
      verdict: "dismiss",
      candidateIds: ["a", "b"],
      reason: "noise",
    });
    expect(last().path).toBe("/api/admin/agent-memory/candidates/bulk");
    expect(json(last())).toEqual({
      action: "dismiss",
      candidateIds: ["a", "b"],
      reason: "noise",
    });
  });
});

describe("web_agent_memory_memories and evidence", () => {
  test("get and act", async () => {
    await client.call("web_agent_memory_memories", { action: "get", id: "m1" });
    expect(last().method).toBe("GET");
    expect(last().path).toBe("/api/admin/agent-memory/memories/m1");
    await client.call("web_agent_memory_memories", {
      action: "act",
      id: "m1",
      decision: { action: "rollback", targetRevision: 2, reason: "r" },
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-memory/memories/m1");
    expect(json(last())).toEqual({
      action: "rollback",
      targetRevision: 2,
      reason: "r",
    });
  });

  test("evidence get", async () => {
    await client.call("web_agent_memory_evidence", {
      action: "get",
      eventId: "e1",
    });
    expect(last().path).toBe("/api/admin/agent-memory/evidence/e1");
  });
});

describe("web_agent_memory_goals / procedures / insights", () => {
  test("goals", async () => {
    await client.call("web_agent_memory_goals", { action: "list" });
    expect(last().path).toBe("/api/admin/agent-memory/goals");
    await client.call("web_agent_memory_goals", {
      action: "update",
      id: "g1",
      title: "Ship",
      reason: "renamed",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/agent-memory/goals/g1");
    expect(json(last())).toMatchObject({ title: "Ship", reason: "renamed" });
  });

  test("procedures", async () => {
    await client.call("web_agent_memory_procedures", {
      action: "update",
      id: "p1",
      lifecycle: "retired",
      reason: "unused",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/agent-memory/procedures/p1");
    expect(json(last())).toMatchObject({ lifecycle: "retired" });
    await client.call("web_agent_memory_procedures", {
      action: "delete",
      id: "p1",
    });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/agent-memory/procedures/p1");
  });

  test("insights", async () => {
    await client.call("web_agent_memory_insights", { action: "create" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-memory/insights");
    await client.call("web_agent_memory_insights", {
      action: "update",
      id: "i1",
      decision: { action: "snooze", snoozedUntil: "2026-10-01T00:00:00.000Z" },
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/agent-memory/insights/i1");
    expect(json(last())).toEqual({
      action: "snooze",
      snoozedUntil: "2026-10-01T00:00:00.000Z",
    });
  });
});

describe("web_agent_memory reflection / suggestions / traces / settings", () => {
  test("reflection", async () => {
    await client.call("web_agent_memory_reflection", { action: "run" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-memory/reflection");
  });

  test("resource suggestions", async () => {
    await client.call("web_agent_memory_resource_suggestions", {
      action: "list",
      status: "pending",
    });
    expect(last().path).toBe(
      "/api/admin/agent-memory/resource-suggestions?status=pending",
    );
    await client.call("web_agent_memory_resource_suggestions", {
      action: "generate",
      entityKey: "host:pi",
    });
    expect(last().method).toBe("POST");
    expect(json(last())).toEqual({ entityKey: "host:pi" });
    await client.call("web_agent_memory_resource_suggestions", {
      action: "decide",
      id: "s1",
      decision: { action: "dismiss", reason: "not a resource" },
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-memory/resource-suggestions/s1");
    expect(json(last())).toMatchObject({ action: "dismiss" });
  });

  test("retrieval traces", async () => {
    await client.call("web_agent_memory_retrieval_traces", {
      action: "list",
      conversationId: "conv1",
      limit: 10,
    });
    expect(last().path).toBe(
      "/api/admin/agent-memory/retrieval-traces?conversationId=conv1&limit=10",
    );
    await client.call("web_agent_memory_retrieval_traces", {
      action: "feedback",
      traceId: "t1",
      feedback: {
        feedbackId: "1b671a64-40d5-491e-99b0-da01ff1f3341",
        kind: "useful",
      },
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe(
      "/api/admin/agent-memory/retrieval-traces/t1/feedback",
    );
    expect(json(last())).toMatchObject({ kind: "useful" });
  });

  test("settings", async () => {
    await client.call("web_agent_memory_settings", {
      action: "update",
      settings: { maximumActionAutonomy: "prepare-only" },
      reason: "tighten",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/agent-memory/settings");
    expect(json(last())).toMatchObject({ reason: "tighten" });
    await client.call("web_agent_memory_settings", {
      action: "set_release_gate",
      gate: "A",
      enabled: true,
    });
    expect(last().method).toBe("POST");
    expect(json(last())).toEqual({ gate: "A", enabled: true });
  });
});

describe("web_markets", () => {
  test("portfolios", async () => {
    await client.call("web_markets_portfolios", {
      action: "update",
      id: "pf1",
      allowShorts: true,
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/markets/portfolios/pf1");
    expect(json(last())).toMatchObject({ allowShorts: true });
    await client.call("web_markets_portfolios", {
      action: "sync_actions",
      id: "pf1",
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/markets/portfolios/pf1/actions/sync");
    await client.call("web_markets_portfolios", {
      action: "performance",
      id: "pf1",
    });
    expect(last().path).toBe("/api/admin/markets/portfolios/pf1/performance");
  });

  test("orders repeat status and route amend/cancel", async () => {
    await client.call("web_markets_orders", {
      action: "list",
      id: "pf1",
      status: ["pending", "working"],
    });
    expect(last().path).toBe(
      "/api/admin/markets/portfolios/pf1/orders?status=pending&status=working",
    );
    await client.call("web_markets_orders", {
      action: "update",
      id: "pf1",
      orderId: "o1",
      limitPrice: 12.5,
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/markets/portfolios/pf1/orders/o1");
    expect(json(last())).toEqual({ limitPrice: 12.5 });
    await client.call("web_markets_orders", {
      action: "cancel",
      id: "pf1",
      orderId: "o1",
    });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/markets/portfolios/pf1/orders/o1");
  });

  test("trades", async () => {
    await client.call("web_markets_trades", {
      action: "create",
      id: "pf1",
      ticker: "AAPL",
      side: "buy",
      quantity: 2,
      price: 100,
      executedAt: "2026-09-01T14:30:00.000Z",
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/markets/portfolios/pf1/trades");
    expect(json(last())).toMatchObject({ ticker: "AAPL", quantity: 2 });
    await client.call("web_markets_trades", {
      action: "delete",
      id: "pf1",
      tradeId: "t1",
    });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/markets/portfolios/pf1/trades/t1");
  });

  test("symbols", async () => {
    await client.call("web_markets_symbols", {
      action: "search",
      q: "apple",
      limit: 5,
    });
    expect(last().path).toBe(
      "/api/admin/markets/symbols/search?q=apple&limit=5",
    );
    await client.call("web_markets_symbols", {
      action: "candles",
      ticker: "AAPL",
      resolution: "1day",
      from: "2026-01-01",
      adjusted: false,
    });
    expect(last().path).toBe(
      "/api/admin/markets/symbols/AAPL/candles?resolution=1day&from=2026-01-01&adjusted=false",
    );
    await client.call("web_markets_symbols", {
      action: "news",
      ticker: "AAPL",
      limit: 3,
    });
    expect(last().path).toBe("/api/admin/markets/symbols/AAPL/news?limit=3");
    await client.call("web_markets_symbols", {
      action: "quotes",
      tickers: ["AAPL", "MSFT"],
    });
    expect(last().path).toBe("/api/admin/markets/quotes?tickers=AAPL%2CMSFT");
    await client.call("web_markets_symbols", { action: "refresh" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/markets/symbols/refresh");
    await client.call("web_markets_symbols", { action: "budget" });
    expect(last().path).toBe("/api/admin/markets/budget");
  });

  test("watchlists", async () => {
    await client.call("web_markets_watchlists", {
      action: "update",
      id: "w1",
      tickers: ["AAPL"],
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/markets/watchlists/w1");
    expect(json(last())).toEqual({ tickers: ["AAPL"] });
  });
});

describe("web_finance", () => {
  test("overview, institutions, fx", async () => {
    await client.call("web_finance", { action: "overview" });
    expect(last().path).toBe("/api/admin/finance");
    await client.call("web_finance", { action: "institutions", country: "PT" });
    expect(last().path).toBe("/api/admin/finance/institutions?country=PT");
    await client.call("web_finance", { action: "fx_refresh" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/finance/fx/refresh");
    await client.call("web_finance", { action: "narrative" });
    expect(last().path).toBe("/api/admin/finance/narrative");
  });

  test("settings_update and link_begin", async () => {
    await client.call("web_finance", {
      action: "settings_update",
      baseCurrency: "EUR",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/finance/settings");
    expect(json(last())).toEqual({ baseCurrency: "EUR" });
    await client.call("web_finance", {
      action: "link_begin",
      institutionId: "inst1",
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/finance/link");
    expect(json(last())).toMatchObject({ institutionId: "inst1" });
  });

  test("accounts", async () => {
    await client.call("web_finance_accounts", {
      action: "update",
      id: "a1",
      displayName: "Main",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/finance/accounts/a1");
    expect(json(last())).toEqual({ displayName: "Main" });
    await client.call("web_finance_accounts", { action: "sync", id: "a1" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/finance/accounts/a1/sync");
  });

  test("category delete sends a body", async () => {
    await client.call("web_finance_categories", {
      action: "delete",
      id: "c1",
      reassignTo: "c2",
    });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/finance/categories/c1");
    expect(json(last())).toEqual({ reassignTo: "c2" });
  });

  test("entries link/unlink/match", async () => {
    await client.call("web_finance_entries", {
      action: "link",
      id: "e1",
      bankLedgerId: "b1",
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/finance/entries/e1/link");
    expect(json(last())).toEqual({ bankLedgerId: "b1" });
    await client.call("web_finance_entries", { action: "unlink", id: "e1" });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/finance/entries/e1/link");
    await client.call("web_finance_entries", {
      action: "match_decide",
      id: "m1",
      decision: "accept",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/finance/matches/m1");
    expect(json(last())).toEqual({ action: "accept" });
    await client.call("web_finance_entries", {
      action: "update",
      id: "e1",
      category: null,
    });
    expect(last().method).toBe("PATCH");
    expect(json(last())).toEqual({ category: null });
  });

  test("rules", async () => {
    await client.call("web_finance_rules", { action: "delete", id: "r1" });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/finance/rules/r1");
  });

  test("budget queries and decisions", async () => {
    await client.call("web_finance_budget", {
      action: "drafts",
      period: "monthly",
      periods: 6,
      headroomPercent: 10,
    });
    expect(last().path).toBe(
      "/api/admin/finance/budget/drafts?period=monthly&periods=6&headroomPercent=10",
    );
    await client.call("web_finance_budget", {
      action: "alerts_list",
      status: ["open", "acknowledged"],
      severity: ["warning"],
    });
    expect(last().path).toBe(
      "/api/admin/finance/budget/alerts?status=open&status=acknowledged&severity=warning",
    );
    await client.call("web_finance_budget", {
      action: "alert_decide",
      id: "al1",
      decision: "acknowledge",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/finance/budget/alerts/al1");
    expect(json(last())).toEqual({ action: "acknowledge" });
    await client.call("web_finance_budget", {
      action: "suggestions_list",
      status: ["open"],
    });
    expect(last().path).toBe(
      "/api/admin/finance/budget/suggestions?status=open",
    );
    await client.call("web_finance_budget", {
      action: "suggestion_decide",
      id: "sg1",
      decision: "apply",
    });
    expect(last().path).toBe("/api/admin/finance/budget/suggestions/sg1");
    expect(json(last())).toEqual({ action: "apply" });
    await client.call("web_finance_budget", { action: "alerts_reevaluate" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/finance/budget/alerts");
  });

  test("envelopes", async () => {
    await client.call("web_finance_envelopes", {
      action: "list",
      includeArchived: true,
    });
    expect(last().path).toBe(
      "/api/admin/finance/envelopes?includeArchived=true",
    );
    await client.call("web_finance_envelopes", {
      action: "contribute",
      id: "env1",
      amountMinor: 5000,
      date: "2026-09-01",
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/finance/envelopes/env1/contributions");
    expect(json(last())).toMatchObject({ amountMinor: 5000 });
    await client.call("web_finance_envelopes", {
      action: "contribution_delete",
      id: "env1",
      contributionId: "ct1",
    });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe(
      "/api/admin/finance/envelopes/env1/contributions/ct1",
    );
  });
});

describe("web_semantic", () => {
  test("routes every action", async () => {
    await client.call("web_semantic", {
      action: "notes",
      status: "pending",
      limit: 50,
    });
    expect(last().path).toBe(
      "/api/admin/semantic/notes?status=pending&limit=50",
    );
    await client.call("web_semantic", { action: "classify", noteId: "n1" });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/semantic/notes/n1/classify");
    await client.call("web_semantic", {
      action: "run_create",
      model: "m",
      initiatedBy: "script",
    });
    expect(last().path).toBe("/api/admin/semantic/runs");
    expect(json(last())).toEqual({ model: "m", initiatedBy: "script" });
    await client.call("web_semantic", {
      action: "run_complete",
      id: "run1",
      status: "failed",
      error: "boom",
    });
    expect(last().path).toBe("/api/admin/semantic/runs/run1/complete");
    expect(json(last())).toEqual({ status: "failed", error: "boom" });
    await client.call("web_semantic", {
      action: "suggestions",
      status: "accepted",
      type: "add-tags",
    });
    expect(last().path).toBe(
      "/api/admin/semantic/suggestions?status=accepted&type=add-tags",
    );
    await client.call("web_semantic", { action: "accept", id: "s1" });
    expect(last().path).toBe("/api/admin/semantic/suggestions/s1/accept");
    await client.call("web_semantic", { action: "dismiss", id: "s1" });
    expect(last().path).toBe("/api/admin/semantic/suggestions/s1/dismiss");
    await client.call("web_semantic", {
      action: "bulk",
      runId: "run1",
      suggestions: [{ type: "add-tags", noteId: "n1", proposedTags: ["x"] }],
    });
    expect(last().path).toBe("/api/admin/semantic/suggestions/bulk");
    expect(json(last())).toMatchObject({ runId: "run1" });
    await client.call("web_semantic", {
      action: "sync",
      force: true,
      limit: 9,
    });
    expect(last().path).toBe("/api/admin/semantic/sync");
    expect(json(last())).toEqual({ force: true, limit: 9 });
  });
});

describe("misc", () => {
  test("dashboard stats, settings, now page, revalidate", async () => {
    await client.call("web_dashboard_stats", {});
    expect(last().path).toBe("/api/admin/dashboard/stats");
    await client.call("web_settings", {
      action: "update",
      timeZone: null,
      semanticModel: "openai/text-embedding-3-small",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/settings");
    expect(json(last())).toEqual({
      timeZone: null,
      semanticModel: "openai/text-embedding-3-small",
    });
    await client.call("web_now_page", { action: "update", content: "# now" });
    expect(last().method).toBe("PUT");
    expect(last().path).toBe("/api/admin/now-page");
    expect(json(last())).toEqual({ content: "# now" });
    await client.call("web_revalidate", { action: "run", targets: ["blog"] });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/revalidate");
    expect(json(last())).toEqual({ targets: ["blog"] });
  });

  test("upload sends a FormData body, not JSON", async () => {
    await client.call("web_upload", {
      action: "file",
      filename: "notes.txt",
      contentType: "text/plain",
      text: "hello",
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/upload/file");
    expect(last().headers["content-type"]).toBeUndefined();
    expect(last().body).toBe("[object FormData]");
    await client.call("web_upload", {
      action: "image",
      filename: "a.png",
      base64: Buffer.from("png").toString("base64"),
    });
    expect(last().path).toBe("/api/admin/upload");
  });

  test("upload refuses oversized and empty input before calling upstream", async () => {
    const big = await client.call("web_upload", {
      action: "image",
      filename: "big.bin",
      base64: Buffer.alloc(9 * 1024 * 1024).toString("base64"),
    });
    expect(big.isError).toBe(true);
    const empty = await client.call("web_upload", {
      action: "image",
      filename: "x",
    });
    expect(empty.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("instagram token and api keys", async () => {
    await client.call("web_instagram_token", { action: "delete" });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/instagram-token");
    await client.call("web_api_keys", { action: "create", name: "ext" });
    expect(last().method).toBe("POST");
    expect(json(last())).toEqual({ name: "ext" });
    await client.call("web_api_keys", { action: "update", id: "k1" });
    expect(last().method).toBe("PUT");
    expect(last().path).toBe("/api/admin/api-keys/k1");
    await client.call("web_api_keys", { action: "delete", id: "k1" });
    expect(last().method).toBe("DELETE");
    expect(last().path).toBe("/api/admin/api-keys/k1");
  });
});

describe("web_authenticator", () => {
  test("routes every action", async () => {
    await client.call("web_authenticator", { action: "codes" });
    expect(last().path).toBe("/api/admin/authenticator/codes");
    await client.call("web_authenticator", {
      action: "create",
      label: "GitHub",
      secret: "JBSWY3DPEHPK3PXP",
      digits: 6,
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/authenticator");
    expect(json(last())).toEqual({
      label: "GitHub",
      secret: "JBSWY3DPEHPK3PXP",
      digits: 6,
    });
    await client.call("web_authenticator", {
      action: "update",
      id: "au1",
      issuer: "GitHub",
    });
    expect(last().method).toBe("PATCH");
    expect(last().path).toBe("/api/admin/authenticator/au1");
    expect(json(last())).toEqual({ issuer: "GitHub" });
    await client.call("web_authenticator", { action: "delete", id: "au1" });
    expect(last().method).toBe("DELETE");
    await client.call("web_authenticator", {
      action: "import",
      uris: ["otpauth://totp/a?secret=JBSWY3DPEHPK3PXP"],
    });
    expect(last().path).toBe("/api/admin/authenticator/import");
    expect(json(last())).toEqual({
      uris: ["otpauth://totp/a?secret=JBSWY3DPEHPK3PXP"],
    });
  });
});
