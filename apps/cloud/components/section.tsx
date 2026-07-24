import type { ReactNode } from "react";

export function Section({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between border-b pb-2">
        <h2 className="text-sm font-semibold">
          {title}
          {count !== undefined && (
            <span className="ml-2 font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
