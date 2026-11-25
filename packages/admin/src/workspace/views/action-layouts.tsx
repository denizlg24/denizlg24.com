import type { ViewRow } from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatValue } from "./format";
import type { LayoutProps } from "./layouts";

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

type ActionLayoutProps = LayoutProps & {
  action: (row: ViewRow) => ReactNode;
};

function RowLink({
  href,
  className,
  children,
}: {
  href: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

function titleOf(props: LayoutProps, row: ViewRow) {
  return (
    formatValue(
      props.descriptor.fields[props.descriptor.titleField],
      row.values[props.descriptor.titleField],
    ) || "Untitled"
  );
}

/** Compact list with a separate action target, so completing a row never opens it. */
export function ActionListLayout(props: ActionLayoutProps) {
  const { descriptor, fields, rowHref, rows, action } = props;
  const secondary = fields.filter((field) => field !== descriptor.titleField);
  return (
    <div data-layout="list" className="flex flex-col">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex min-w-0 items-center gap-2 border-b py-1.5"
        >
          <RowLink
            href={rowHref(row)}
            className="flex min-w-0 flex-1 items-baseline gap-3 text-sm hover:bg-surface/70"
          >
            <span
              data-row={row.id}
              className="min-w-0 truncate text-accent-strong"
            >
              {titleOf(props, row)}
            </span>
            <span className="ml-auto flex shrink-0 gap-3 text-xs tabular-nums text-muted-foreground">
              {secondary.map((field) => {
                const text = formatValue(
                  descriptor.fields[field],
                  row.values[field],
                );
                return text ? <span key={field}>{text}</span> : null;
              })}
            </span>
          </RowLink>
          {action(row)}
        </div>
      ))}
    </div>
  );
}

/** Table with an explicit action column; used by the Home triage queue. */
export function ActionTableLayout(props: ActionLayoutProps) {
  const { descriptor, fields, rowHref, rows, action } = props;
  return (
    <div className="overflow-x-auto">
      <table data-layout="table" className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            {fields.map((field) => {
              const def = descriptor.fields[field];
              const numeric = def?.type === "money" || def?.type === "number";
              return (
                <th
                  key={field}
                  className={cn(
                    LABEL,
                    "px-2 py-1.5 font-medium",
                    numeric ? "text-right" : "text-left",
                  )}
                >
                  {def?.label ?? field}
                </th>
              );
            })}
            <th aria-label="Actions" className="w-8 px-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-row={row.id}
              className="border-b hover:bg-surface/70"
            >
              {fields.map((field, index) => {
                const def = descriptor.fields[field];
                const text = formatValue(def, row.values[field]);
                const numeric = def?.type === "money" || def?.type === "number";
                return (
                  <td
                    key={field}
                    className={cn(
                      "px-2 py-1.5 align-top",
                      numeric && "text-right tabular-nums",
                      index > 0 && "text-muted-foreground",
                    )}
                  >
                    {index === 0 ? (
                      <RowLink
                        href={rowHref(row)}
                        className="text-accent-strong hover:underline"
                      >
                        {text || "Untitled"}
                      </RowLink>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
              <td className="px-1 py-1 text-right">{action(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
