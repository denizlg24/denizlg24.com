import type { ReactNode } from "react";

export function PageHeading({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-start gap-4 border-b pb-4">
      <div className="min-w-0 flex-1">
        <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
        {detail ? (
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
