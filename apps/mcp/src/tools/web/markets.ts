import type { McpServer } from "@modelcontextprotocol/server";
import {
  orderAmendSchema,
  orderInputSchema,
  orderStatusSchema,
  portfolioInputSchema,
  resolutionSchema,
  tradeInputSchema,
  watchlistInputSchema,
} from "@repo/schemas/markets";
import { z } from "zod";
import { type Api, action, defineActions, limit, p } from "../define";

const base = "/api/admin/markets";
const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });
const ticker = z.string().min(1).describe("Ticker symbol");
const byTicker = z.object({ ticker });

export function registerWebMarkets(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_markets_portfolios",
    title: "Web: market portfolios",
    description: "Paper portfolios, their corporate actions and performance.",
    actions: {
      list: action({
        description: "Every portfolio",
        readOnly: true,
        run: () => api.web.get(`${base}/portfolios`),
      }),
      get: action({
        description: "One portfolio with positions",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/markets/portfolios/${id}`),
      }),
      create: action({
        description: "Creates a portfolio",
        input: z.object(portfolioInputSchema.shape),
        run: (body) => api.web.post(`${base}/portfolios`, body),
      }),
      update: action({
        description: "Changes any portfolio setting",
        input: z.object({ id, ...portfolioInputSchema.partial().shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/markets/portfolios/${id}`, body),
      }),
      delete: action({
        description: "Deletes a portfolio and its book",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/markets/portfolios/${id}`),
      }),
      sync_actions: action({
        description: "Re-syncs dividends, DRIP and splits",
        input: byId,
        run: ({ id }) =>
          api.web.post(p`/api/admin/markets/portfolios/${id}/actions/sync`),
      }),
      performance: action({
        description: "Equity curve, metrics and margin",
        input: byId,
        readOnly: true,
        run: ({ id }) =>
          api.web.get(p`/api/admin/markets/portfolios/${id}/performance`),
      }),
    },
  });

  const orderId = z.string().min(1).describe("Order id");
  defineActions(server, {
    name: "web_markets_orders",
    title: "Web: market orders",
    description:
      "Simulated order book per portfolio; fills happen on the cron.",
    actions: {
      list: action({
        description: "Orders, optionally narrowed to statuses",
        input: z.object({ id, status: z.array(orderStatusSchema).optional() }),
        readOnly: true,
        run: ({ id, status }) =>
          api.web.get(p`/api/admin/markets/portfolios/${id}/orders`, {
            status,
          }),
      }),
      create: action({
        description: "Places an order (422 when refused by buying power)",
        input: z.object({ id, order: orderInputSchema }),
        run: ({ id, order }) =>
          api.web.post(p`/api/admin/markets/portfolios/${id}/orders`, order),
      }),
      update: action({
        description: "Amends price, size or TIF",
        input: z.object({ id, orderId, ...orderAmendSchema.shape }),
        idempotent: true,
        run: ({ id, orderId, ...body }) =>
          api.web.patch(
            p`/api/admin/markets/portfolios/${id}/orders/${orderId}`,
            body,
          ),
      }),
      cancel: action({
        description: "Cancels an order and its pending bracket legs",
        input: z.object({ id, orderId }),
        destructive: true,
        run: ({ id, orderId }) =>
          api.web.delete(
            p`/api/admin/markets/portfolios/${id}/orders/${orderId}`,
          ),
      }),
    },
  });

  const tradeId = z.string().min(1).describe("Trade id");
  defineActions(server, {
    name: "web_markets_trades",
    title: "Web: market trades",
    description: "Manual trades booked against a portfolio.",
    actions: {
      list: action({
        description: "Every trade of a portfolio",
        input: byId,
        readOnly: true,
        run: ({ id }) =>
          api.web.get(p`/api/admin/markets/portfolios/${id}/trades`),
      }),
      create: action({
        description: "Books a trade",
        input: z.object({ id, ...tradeInputSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/markets/portfolios/${id}/trades`, body),
      }),
      delete: action({
        description: "Removes a trade",
        input: z.object({ id, tradeId }),
        destructive: true,
        run: ({ id, tradeId }) =>
          api.web.delete(
            p`/api/admin/markets/portfolios/${id}/trades/${tradeId}`,
          ),
      }),
    },
  });

  const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  defineActions(server, {
    name: "web_markets_symbols",
    title: "Web: market symbols",
    description: "Symbol universe, quotes, candles and reference data.",
    actions: {
      search: action({
        description: "Symbol search by name or ticker",
        input: z.object({ q: z.string().min(1), limit }),
        readOnly: true,
        run: (query) => api.web.get(`${base}/symbols/search`, query),
      }),
      get: action({
        description: "Instrument profile",
        input: byTicker,
        readOnly: true,
        run: ({ ticker }) =>
          api.web.get(p`/api/admin/markets/symbols/${ticker}`),
      }),
      actions: action({
        description: "Corporate actions",
        input: byTicker,
        readOnly: true,
        run: ({ ticker }) =>
          api.web.get(p`/api/admin/markets/symbols/${ticker}/actions`),
      }),
      candles: action({
        description: "OHLCV bars; from/to are ISO dates",
        input: z.object({
          ticker,
          resolution: resolutionSchema.optional(),
          from: isoDate.optional(),
          to: isoDate.optional(),
          adjusted: z.boolean().optional(),
        }),
        readOnly: true,
        run: ({ ticker, ...query }) =>
          api.web.get(p`/api/admin/markets/symbols/${ticker}/candles`, query),
      }),
      filings: action({
        description: "Recent filings",
        input: z.object({ ticker, limit }),
        readOnly: true,
        run: ({ ticker, limit }) =>
          api.web.get(p`/api/admin/markets/symbols/${ticker}/filings`, {
            limit,
          }),
      }),
      fundamentals: action({
        description: "Fundamentals snapshot",
        input: byTicker,
        readOnly: true,
        run: ({ ticker }) =>
          api.web.get(p`/api/admin/markets/symbols/${ticker}/fundamentals`),
      }),
      news: action({
        description: "Recent news",
        input: z.object({ ticker, limit }),
        readOnly: true,
        run: ({ ticker, limit }) =>
          api.web.get(p`/api/admin/markets/symbols/${ticker}/news`, { limit }),
      }),
      refresh: action({
        description: "Re-pulls the symbol universe",
        run: () => api.web.post(`${base}/symbols/refresh`),
      }),
      quotes: action({
        description: "Live quotes for up to 200 tickers",
        input: z.object({ tickers: z.array(ticker).min(1).max(200) }),
        readOnly: true,
        run: ({ tickers }) =>
          api.web.get(`${base}/quotes`, { tickers: tickers.join(",") }),
      }),
      budget: action({
        description: "Provider request budget",
        readOnly: true,
        run: () => api.web.get(`${base}/budget`),
      }),
    },
  });

  defineActions(server, {
    name: "web_markets_watchlists",
    title: "Web: market watchlists",
    description: "Named ticker lists.",
    actions: {
      list: action({
        description: "Every watchlist",
        readOnly: true,
        run: () => api.web.get(`${base}/watchlists`),
      }),
      create: action({
        description: "Creates a watchlist",
        input: z.object(watchlistInputSchema.shape),
        run: (body) => api.web.post(`${base}/watchlists`, body),
      }),
      update: action({
        description: "Renames or replaces tickers",
        input: z.object({ id, ...watchlistInputSchema.partial().shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/markets/watchlists/${id}`, body),
      }),
      delete: action({
        description: "Deletes a watchlist",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/markets/watchlists/${id}`),
      }),
    },
  });
}
