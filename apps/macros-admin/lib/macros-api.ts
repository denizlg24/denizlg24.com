import "server-only";

import {
  type MacrosContributionsQuery,
  type MacrosReportStatusFilter,
  type MacrosResolveReportBody,
  type MacrosSetFoodRemovedBody,
  type MacrosSetRestrictionBody,
  macrosContributionsResponseSchema,
  macrosContributorDetailSchema,
  macrosModerationEventsResponseSchema,
  macrosModerationOverviewSchema,
  macrosReportCaseSchema,
  macrosReportCasesResponseSchema,
  macrosRevealContactResponseSchema,
} from "@repo/schemas/macros";
import { z } from "zod";

export type ApiFailure = { ok: false; status: number; error: string };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

const errorBodySchema = z.object({ error: z.string() });
const okBodySchema = z.object({ ok: z.literal(true) });

function apiBaseUrl(): string {
  return (
    process.env.MACROS_API_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://macros.denizlg24.com"
      : "http://localhost:3000")
  );
}

async function request<S extends z.ZodType>(
  accessToken: string,
  path: string,
  schema: S,
  write?: { method: "POST" | "PUT"; body?: unknown },
): Promise<ApiResult<z.output<S>>> {
  const headers = new Headers({
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  });
  if (write?.body !== undefined)
    headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(new URL(path, apiBaseUrl()), {
      method: write?.method ?? "GET",
      headers,
      body: write?.body === undefined ? undefined : JSON.stringify(write.body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, error: "Macros API unreachable" };
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = errorBodySchema.safeParse(payload);
    return {
      ok: false,
      status: response.status,
      error: body.success ? body.data.error : response.statusText,
    };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, status: 502, error: "Unexpected response shape" };
  }
  return { ok: true, data: parsed.data };
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function macrosApi(session: { accessToken: string }) {
  const token = session.accessToken;
  return {
    overview: () =>
      request(token, "/api/admin/overview", macrosModerationOverviewSchema),

    reports: (status: MacrosReportStatusFilter) =>
      request(
        token,
        `/api/admin/reports?status=${status}`,
        macrosReportCasesResponseSchema,
      ),

    report: (itemId: string) =>
      request(
        token,
        `/api/admin/reports/${segment(itemId)}`,
        macrosReportCaseSchema,
      ),

    resolveReport: (itemId: string, body: MacrosResolveReportBody) =>
      request(
        token,
        `/api/admin/reports/${segment(itemId)}`,
        macrosReportCaseSchema.nullable(),
        { method: "POST", body },
      ),

    contributions: (query: MacrosContributionsQuery) => {
      const params = new URLSearchParams();
      if (query.status) params.set("status", query.status);
      if (query.q) params.set("q", query.q);
      if (query.contributor) params.set("contributor", query.contributor);
      if (query.cursor) params.set("cursor", query.cursor);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      return request(
        token,
        `/api/admin/contributions?${params}`,
        macrosContributionsResponseSchema,
      );
    },

    setFoodRemoved: (itemId: string, body: MacrosSetFoodRemovedBody) =>
      request(token, `/api/admin/foods/${segment(itemId)}`, okBodySchema, {
        method: "PUT",
        body,
      }),

    contributor: (userId: string) =>
      request(
        token,
        `/api/admin/contributors/${segment(userId)}`,
        macrosContributorDetailSchema,
      ),

    setRestriction: (userId: string, body: MacrosSetRestrictionBody) =>
      request(
        token,
        `/api/admin/contributors/${segment(userId)}/restriction`,
        macrosContributorDetailSchema.nullable(),
        { method: "PUT", body },
      ),

    revealContact: (userId: string) =>
      request(
        token,
        `/api/admin/contributors/${segment(userId)}/contact`,
        macrosRevealContactResponseSchema,
        { method: "POST" },
      ),

    events: (query: { subject?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (query.subject) params.set("subject", query.subject);
      if (query.limit !== undefined) params.set("limit", String(query.limit));
      return request(
        token,
        `/api/admin/events?${params}`,
        macrosModerationEventsResponseSchema,
      );
    },
  };
}

export type MacrosApi = ReturnType<typeof macrosApi>;
