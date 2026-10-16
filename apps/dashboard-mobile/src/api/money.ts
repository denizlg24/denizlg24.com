import { DashboardNative } from "@modules/dashboard-native";
import type {
  FinanceBudgetAlertDecision,
  FinanceBudgetOverview,
  FinanceDashboardResponse,
  FinanceLedgerEntryUpdate,
  FinanceMatchDecision,
} from "@repo/schemas";
import type {
  OrdersResponse,
  orderInputSchema,
  PortfolioPerformance,
  PortfoliosResponse,
  QuotesResponse,
  WatchlistsResponse,
} from "@repo/schemas/markets";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { widgetQuotes } from "@/features/money/quotes";
import { api } from "@/lib/api";
import { todayKey } from "./today";

export const financeKey = ["finance"] as const;
export const budgetKey = ["finance", "budget"] as const;

export function useFinance() {
  return useQuery({
    queryKey: financeKey,
    queryFn: () => api.request<FinanceDashboardResponse>("finance"),
  });
}

export function useBudget() {
  return useQuery({
    queryKey: budgetKey,
    queryFn: () => api.request<FinanceBudgetOverview>("finance/budget"),
  });
}

function useRefreshFinance() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: financeKey });
    void client.invalidateQueries({ queryKey: todayKey });
  };
}

export function useDecideAlert() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: FinanceBudgetAlertDecision["action"];
    }) =>
      api.request(`finance/budget/alerts/${id}`, {
        method: "PATCH",
        body: { action },
      }),
    onSettled: refresh,
  });
}

export function useUpdateEntry() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: ({
      id,
      update,
    }: {
      id: string;
      update: FinanceLedgerEntryUpdate;
    }) =>
      api.request(`finance/entries/${id}`, { method: "PATCH", body: update }),
    onSettled: refresh,
  });
}

export function useDecideMatch() {
  const refresh = useRefreshFinance();
  return useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: FinanceMatchDecision["action"];
    }) =>
      api.request(`finance/matches/${id}`, {
        method: "PATCH",
        body: { action },
      }),
    onSettled: refresh,
  });
}

export function useWatchlists() {
  return useQuery({
    queryKey: ["markets", "watchlists"],
    queryFn: async () =>
      (await api.request<WatchlistsResponse>("markets/watchlists")).watchlists,
    staleTime: 10 * 60_000,
  });
}

/**
 * The provider allows 50 requests an hour for everything, so quotes are one
 * batched call, fresh for a minute: focus and pull-to-refresh inside that
 * minute reuse what is here. The widget gets the same answer, never its own.
 */
export const QUOTE_FRESH_MS = 60_000;

export function useQuotes(tickers: string[]) {
  const sorted = [...new Set(tickers)].sort();
  return useQuery({
    queryKey: ["markets", "quotes", sorted.join(",")],
    enabled: sorted.length > 0,
    staleTime: QUOTE_FRESH_MS,
    queryFn: async () => {
      const result = await api.request<QuotesResponse>("markets/quotes", {
        query: { tickers: sorted.join(",") },
      });
      DashboardNative?.setWatchlist(
        JSON.stringify(widgetQuotes(tickers, result.quotes)),
      );
      return result;
    },
  });
}

export function usePortfolios() {
  return useQuery({
    queryKey: ["markets", "portfolios"],
    queryFn: async () =>
      (await api.request<PortfoliosResponse>("markets/portfolios")).portfolios,
    staleTime: 10 * 60_000,
  });
}

export function usePerformance(id: string) {
  return useQuery({
    queryKey: ["markets", "performance", id],
    staleTime: QUOTE_FRESH_MS,
    queryFn: () =>
      api.request<PortfolioPerformance>(`markets/portfolios/${id}/performance`),
  });
}

export function useOrders(id: string) {
  return useQuery({
    queryKey: ["markets", "orders", id],
    queryFn: async () =>
      (
        await api.request<OrdersResponse>(`markets/portfolios/${id}/orders`, {
          query: { status: ["pending", "working"] },
        })
      ).orders,
  });
}

function useRefreshBook(id: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["markets", "orders", id] });
    void client.invalidateQueries({ queryKey: ["markets", "performance", id] });
  };
}

export type OrderDraft = z.input<typeof orderInputSchema>;

export function usePlaceOrder(portfolioId: string) {
  const refresh = useRefreshBook(portfolioId);
  return useMutation({
    mutationFn: (order: OrderDraft) =>
      api.request<OrdersResponse>(`markets/portfolios/${portfolioId}/orders`, {
        method: "POST",
        body: order,
      }),
    onSettled: refresh,
  });
}

export function useCancelOrder(portfolioId: string) {
  const refresh = useRefreshBook(portfolioId);
  return useMutation({
    mutationFn: (orderId: string) =>
      api.request(`markets/portfolios/${portfolioId}/orders/${orderId}`, {
        method: "DELETE",
      }),
    onSettled: refresh,
  });
}
