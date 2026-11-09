import type { ReactNode } from "react";

/** The frame of every grid page: room for the nav, a heading, the grid. */
export function GridPage({
  heading,
  note,
  children,
}: {
  heading: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6 px-[var(--gutter)] pt-24 pb-20 md:space-y-8 md:pt-28">
      <div className="min-w-0 space-y-2">
        <h1 className="text-[clamp(1.6rem,2.6vw,2.6rem)] leading-tight font-bold break-words">
          {heading}
        </h1>
        {note ? <div className="text-paper/70">{note}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h2 className="font-display text-4xl">{title}</h2>
      <div className="text-paper/70">{body}</div>
      {action}
    </div>
  );
}
