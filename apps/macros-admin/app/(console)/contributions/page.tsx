import { Input } from "@repo/ui/input";
import { Search, X } from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { z } from "zod";

import { ApiFailureView } from "@/components/api-failure";
import { ContributionList } from "@/components/contribution-list";
import { FilterNav } from "@/components/filter-nav";
import { PageHeader } from "@/components/page";
import { macrosApi } from "@/lib/macros-api";
import { requireOwner } from "@/lib/session";

export const metadata: Metadata = { title: "Contributions" };

const PAGE_SIZE = 50;

const STATUSES = [
  { value: "all", label: "All" },
  { value: "visible", label: "Visible" },
  { value: "removed", label: "Removed" },
] as const;

type Status = (typeof STATUSES)[number]["value"];

const statusSchema = z.enum(["all", "visible", "removed"]);
const querySchema = z.string().trim().max(100);

function contributionsHref(status: Status, q: string | undefined): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (q) params.set("q", q);
  const query = params.toString();
  return query ? `/contributions?${query}` : "/contributions";
}

export default async function ContributionsPage({
  searchParams,
}: PageProps<"/contributions">) {
  const params = await searchParams;
  const parsedStatus = statusSchema.safeParse(params.status);
  const status: Status = parsedStatus.success ? parsedStatus.data : "all";
  const parsedQuery = querySchema.safeParse(params.q);
  const q =
    parsedQuery.success && parsedQuery.data ? parsedQuery.data : undefined;

  const session = await requireOwner(contributionsHref(status, q));
  const result = await macrosApi(session).contributions({
    status,
    q,
    limit: PAGE_SIZE,
  });
  const now = Date.now();

  return (
    <div className="flex flex-col gap-2">
      <PageHeader bordered={false} title="Contributions" />
      <div className="flex flex-col gap-2">
        <div className="flex flex-col-reverse gap-3 border-b sm:flex-row sm:items-end sm:justify-between">
          <FilterNav
            label="Contribution status"
            value={status}
            options={STATUSES}
            href={(value) => contributionsHref(value, q)}
          />
          <Form
            action="/contributions"
            role="search"
            className="relative w-full sm:mb-2 sm:w-72"
          >
            {status !== "all" ? (
              <input type="hidden" name="status" value={status} />
            ) : null}
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Name, brand or barcode"
              aria-label="Search contributions"
              maxLength={100}
              autoComplete="off"
              className="h-9 pr-8 pl-8 sm:h-8 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {q ? (
              <Link
                href={contributionsHref(status, undefined)}
                aria-label="Clear search"
                className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <X className="size-3.5" />
              </Link>
            ) : null}
          </Form>
        </div>
        {result.ok ? (
          <ContributionList
            key={`${status}:${q ?? ""}`}
            initial={result.data.contributions}
            initialCursor={result.data.nextCursor}
            query={{ status, q }}
            pageSize={PAGE_SIZE}
            now={now}
          />
        ) : (
          <ApiFailureView failure={result} />
        )}
      </div>
    </div>
  );
}
