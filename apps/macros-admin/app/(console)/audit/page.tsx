import { X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { ApiFailureView } from "@/components/api-failure";
import { EventTable } from "@/components/events";
import { PageHeader } from "@/components/page";
import { RefreshButton } from "@/components/refresh-button";
import { plural } from "@/lib/format";
import { macrosApi } from "@/lib/macros-api";
import { describeEvent } from "@/lib/moderation";
import { requireOwner } from "@/lib/session";
import { resolveSubjectLabels } from "@/lib/subjects";

export const metadata: Metadata = { title: "Audit log" };

const LIMIT = 200;
const subjectSchema = z.string().trim().min(1).max(100);

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const params = await searchParams;
  const parsed = subjectSchema.safeParse(params.subject);
  const subject = parsed.success ? parsed.data : undefined;
  const session = await requireOwner(
    subject ? `/audit?subject=${encodeURIComponent(subject)}` : "/audit",
  );
  const api = macrosApi(session);
  const result = await api.events({ subject, limit: LIMIT });
  const now = Date.now();

  if (!result.ok) {
    return (
      <>
        <PageHeader title="Audit log" />
        <ApiFailureView failure={result} />
      </>
    );
  }

  const labels = await resolveSubjectLabels(api, result.data.events);
  const events = result.data.events.map((event) =>
    describeEvent(event, { ownerId: session.user.id, labels }),
  );
  const subjectLabel = subject ? (labels.get(subject) ?? "1 subject") : null;

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        bordered={false}
        title="Audit log"
        meta={
          <>
            <span className="tabular-nums">
              {events.length >= LIMIT
                ? `Latest ${LIMIT}`
                : plural(events.length, "event")}
            </span>
            {subjectLabel ? (
              <Link
                href="/audit"
                aria-label={`Clear filter ${subjectLabel}`}
                className="inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs text-foreground outline-none transition-colors hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {subjectLabel}
                <X className="size-3" aria-hidden />
              </Link>
            ) : null}
          </>
        }
        actions={<RefreshButton label="Refresh" />}
      />
      <EventTable events={events} now={now} />
    </div>
  );
}
