import type { McpServer } from "@modelcontextprotocol/server";
import { brokerageSyncInputSchema } from "@repo/schemas";
import { type Api, action, defineActions } from "../define";

export function registerWebBrokerage(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_brokerage",
    title: "Web: brokerage holdings",
    description:
      "The real Interactive Brokers account, read-only from IBKR Flex statements: value, P&L, time-weighted return, positions, cash and activity. Separate from the simulated web_markets_* portfolios.",
    actions: {
      overview: action({
        description:
          "Latest statement day's value, day and total P&L, positions, cash per currency, the daily value series and the last 50 trades and cash transactions; amounts in the account's base currency unless a row names its own",
        readOnly: true,
        run: () => api.web.get("/api/admin/brokerage"),
      }),
      sync: action({
        description:
          "Pulls the daily Flex statement now, or with `history` the last 365 days; takes up to a few minutes",
        input: brokerageSyncInputSchema,
        idempotent: true,
        run: (body) => api.web.post("/api/admin/brokerage/sync", body),
      }),
    },
  });
}
