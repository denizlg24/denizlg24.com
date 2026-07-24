import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <span className="text-sm font-semibold tracking-tight">
          deniz<span className="text-muted-foreground">cloud</span>
        </span>
        <h1 className="mt-8 text-lg font-medium tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        )}
        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
