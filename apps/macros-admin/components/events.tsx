import { StatusDot } from "@repo/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/table";
import { cn } from "@repo/ui/utils";
import Link from "next/link";

import { Time } from "@/components/moderation";
import { Empty } from "@/components/page";
import {
  stackAbove,
  stackBody,
  stackCell,
  stackEnd,
  stackFull,
  stackHead,
  stackLead,
  stackRow,
  stackTable,
} from "@/components/stack-table";
import type { EventSubject, EventView } from "@/lib/moderation";

function SubjectLink({
  subject,
  className,
}: {
  subject: EventSubject;
  className?: string;
}) {
  const mono = subject.kind === "contributor";
  const label = (
    <span className={cn(mono && "font-mono text-xs")}>{subject.label}</span>
  );
  if (!subject.href) return <span className={className}>{label}</span>;
  return (
    <Link
      href={subject.href}
      className={cn(
        "rounded-sm text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:text-accent-strong hover:decoration-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      {label}
    </Link>
  );
}

function Reason({ text }: { text: string }) {
  return <span className="break-words">“{text}”</span>;
}

/** Compact two-line rows, for a column beside other content. */
export function EventList({
  events,
  now,
  showSubject = true,
}: {
  events: EventView[];
  now: number;
  showSubject?: boolean;
}) {
  if (events.length === 0) return <Empty />;
  return (
    <ol className="flex flex-col">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex gap-3 border-b py-2.5 last:border-b-0"
        >
          <StatusDot tone={event.tone} className="mt-[7px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-sm">
                <span className="font-medium text-accent-strong">
                  {event.action}
                </span>
                {showSubject ? (
                  <>
                    {" "}
                    <SubjectLink subject={event.subject} />
                  </>
                ) : null}
              </p>
              <Time
                iso={event.createdAt}
                now={now}
                className="shrink-0 text-xs text-muted-foreground"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {event.actor}
              {event.detail ? (
                <>
                  {" · "}
                  <Reason text={event.detail} />
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The full log: a table on wide screens, stacked rows on a phone. */
export function EventTable({
  events,
  now,
}: {
  events: EventView[];
  now: number;
}) {
  if (events.length === 0) return <Empty />;
  return (
    <Table className={stackTable}>
      <TableHeader className={stackHead}>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-0 pl-0 text-xs font-normal text-muted-foreground">
            Time
          </TableHead>
          <TableHead className="text-xs font-normal text-muted-foreground">
            Action
          </TableHead>
          <TableHead className="text-xs font-normal text-muted-foreground">
            Subject
          </TableHead>
          <TableHead className="text-xs font-normal text-muted-foreground">
            Actor
          </TableHead>
          <TableHead className="w-full pr-0 text-xs font-normal text-muted-foreground">
            Detail
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className={stackBody}>
        {events.map((event) => (
          <TableRow key={event.id} className={cn(stackRow, "align-top")}>
            <TableCell
              className={cn(
                stackCell,
                "align-baseline",
                "py-3 pl-0 text-xs text-muted-foreground max-md:row-start-1",
                stackEnd,
              )}
            >
              <Time iso={event.createdAt} now={now} />
            </TableCell>
            <TableCell
              className={cn(
                stackCell,
                "align-baseline py-3 max-md:min-w-0",
                stackLead,
              )}
            >
              <span className="inline-flex items-center gap-2 font-medium text-accent-strong">
                <StatusDot tone={event.tone} />
                {event.action}
              </span>
            </TableCell>
            <TableCell
              className={cn(
                stackCell,
                "align-baseline",
                "max-w-64 truncate py-3 max-md:row-start-2 max-md:max-w-none max-md:pl-4",
                stackFull,
              )}
            >
              <SubjectLink subject={event.subject} className={stackAbove} />
            </TableCell>
            <TableCell
              className={cn(
                stackCell,
                "align-baseline",
                "py-3 text-xs text-muted-foreground max-md:col-start-1 max-md:row-start-3 max-md:pl-4",
              )}
            >
              {event.actor}
            </TableCell>
            <TableCell
              className={cn(
                stackCell,
                "align-baseline",
                "py-3 pr-0 text-xs whitespace-normal text-muted-foreground max-md:col-span-4 max-md:col-start-2 max-md:row-start-3 max-md:min-w-0",
              )}
            >
              {event.detail ? <Reason text={event.detail} /> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
