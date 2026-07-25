import type { ReactNode } from "react";

export function AuthShell({
  title,
  error,
  children,
}: {
  title: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-xs">
        <span className="text-sm font-semibold tracking-tight">
          deniz<span className="text-muted-foreground">cloud</span>
        </span>
        <h1 className="mt-8 text-sm font-medium tracking-tight">{title}</h1>
        {error && (
          <p className="mt-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
