"use client";

import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowUpRight as External,
  CircleAlert,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { percent, tone } from "@/lib/utils";

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.error ?? "The request could not be completed.",
    ) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export function Change({
  value,
  arrows = false,
}: {
  value: number | null | undefined;
  arrows?: boolean;
}) {
  const Icon = value != null && value < 0 ? ArrowDownRight : ArrowUpRight;
  return (
    <span className={`change ${tone(value)}`}>
      {arrows && value ? <Icon size={14} aria-hidden /> : null}
      {percent(value)}
    </span>
  );
}

export function PanelHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Empty({
  children,
  title,
}: {
  children?: ReactNode;
  title: string;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export function Loading({
  message = "Loading market data",
}: {
  message?: string;
}) {
  return (
    <div className="loading-box" role="status">
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="skeleton" />
      <span className="sr-only">{message}</span>
    </div>
  );
}

export function Failure({
  error,
  retry,
}: {
  error: Error | undefined;
  retry?: () => unknown;
}) {
  if (!error) return null;
  return (
    <div className="failure" role="alert">
      <CircleAlert size={16} />
      <span>{error.message}</span>
      {retry ? (
        <Button variant="ghost" size="sm" onClick={() => void retry()}>
          <RefreshCw /> Retry
        </Button>
      ) : null}
    </div>
  );
}

export function SourceLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a className="source-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <External size={13} aria-hidden />
    </a>
  );
}
