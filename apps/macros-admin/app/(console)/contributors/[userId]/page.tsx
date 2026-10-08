import type { MacrosContributorDetail } from "@repo/schemas/macros";
import { Badge } from "@repo/ui/badge";
import type { StatusTone } from "@repo/ui/status-dot";
import { StatusDot } from "@repo/ui/status-dot";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiFailureView } from "@/components/api-failure";
import { ContributionList } from "@/components/contribution-list";
import { EventList } from "@/components/events";
import { PageHeader, Section, StatGrid } from "@/components/page";
import { RestrictionForm } from "@/components/restriction-form";
import { RevealContact } from "@/components/reveal-contact";
import { formatAbsolute, formatCount, formatDate } from "@/lib/format";
import { macrosApi } from "@/lib/macros-api";
import { describeEvent } from "@/lib/moderation";
import { requireOwner } from "@/lib/session";

export const metadata: Metadata = { title: "Contributor" };

const PAGE_SIZE = 50;
const BACK = { href: "/contributions", label: "Contributions" };

function restrictionBadge(
  restriction: MacrosContributorDetail["restriction"],
): { label: string; tone: StatusTone } | null {
  if (restriction.suspended)
    return { label: "Account suspended", tone: "critical" };
  if (restriction.sharingSuspended) {
    return { label: "Sharing suspended", tone: "serious" };
  }
  return null;
}

export default async function ContributorPage({
  params,
}: PageProps<"/contributors/[userId]">) {
  const { userId } = await params;
  if (!userId || userId.length > 200) notFound();
  const session = await requireOwner(
    `/contributors/${encodeURIComponent(userId)}`,
  );
  const api = macrosApi(session);
  const [found, history] = await Promise.all([
    api.contributor(userId),
    api.events({ subject: userId, limit: 50 }),
  ]);

  if (!found.ok) {
    if (found.status === 404) notFound();
    return (
      <>
        <PageHeader back={BACK} title="Contributor" />
        <ApiFailureView failure={found} />
      </>
    );
  }

  const detail = found.data;
  const now = Date.now();
  const labels = new Map([[userId, detail.contributor.alias]]);
  const events = (history.ok ? history.data.events : []).map((event) =>
    describeEvent(event, { ownerId: session.user.id, labels }),
  );
  const badge = restrictionBadge(detail.restriction);
  const visible = detail.contributions - detail.removedContributions;
  const lastRecent = detail.recent.at(-1);
  const initialCursor =
    lastRecent && detail.recent.length < detail.contributions
      ? lastRecent.createdAt
      : null;

  return (
    <>
      <PageHeader
        back={BACK}
        bordered={false}
        title={detail.contributor.alias}
        titleClassName="font-mono font-medium tracking-normal"
        meta={
          <>
            {badge ? (
              <Badge
                variant="outline"
                className="mr-1 gap-1.5 font-normal text-foreground"
              >
                <StatusDot tone={badge.tone} />
                {badge.label}
              </Badge>
            ) : null}
            <span>
              Joined{" "}
              <time
                dateTime={detail.joinedAt}
                title={formatAbsolute(detail.joinedAt)}
              >
                {formatDate(detail.joinedAt)}
              </time>
            </span>
          </>
        }
      />
      <StatGrid
        className="lg:grid-cols-5"
        stats={[
          { label: "Contributions", value: formatCount(detail.contributions) },
          { label: "Removed", value: formatCount(detail.removedContributions) },
          {
            label: "Reports against",
            value: formatCount(detail.reportsAgainst),
          },
          { label: "Reports filed", value: formatCount(detail.reportsFiled) },
          { label: "Blocked by", value: formatCount(detail.blockedBy) },
        ]}
      />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Section
          title="Contributions"
          count={formatCount(detail.contributions)}
          className="order-2 lg:order-1"
        >
          <ContributionList
            initial={detail.recent}
            initialCursor={initialCursor}
            query={{ status: "all", contributor: userId }}
            pageSize={PAGE_SIZE}
            now={now}
            showContributor={false}
          />
        </Section>
        <aside className="order-1 flex min-w-0 flex-col gap-10 lg:order-2">
          <Section title="Restriction">
            <RestrictionForm
              key={detail.restriction.updatedAt ?? "none"}
              userId={userId}
              alias={detail.contributor.alias}
              restriction={detail.restriction}
              visibleContributions={visible}
              now={now}
            />
          </Section>
          <Section title="Contact">
            <RevealContact userId={userId} />
          </Section>
          <Section title="History" count={events.length}>
            <EventList events={events} now={now} showSubject={false} />
          </Section>
        </aside>
      </div>
    </>
  );
}
