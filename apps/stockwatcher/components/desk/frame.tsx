"use client";

import { MessageSquareText } from "lucide-react";
import {
  createContext,
  type ReactNode,
  use,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import type { DashboardState } from "@/lib/assistant-types";
import type { Widget } from "@/lib/desk";
import type { Workspace } from "@/lib/models";
import { cn, today } from "@/lib/utils";

export type WidgetContext = {
  workspace: Workspace;
  refresh: boolean;
  aiEnabled: boolean;
  onOpenSymbol: (symbol: string) => void;
  onOpenView: (state: DashboardState) => void;
  update: (next: Widget) => Promise<void>;
  remove: () => Promise<void>;
};

export type WidgetProps<K extends Widget["kind"]> = {
  widget: Extract<Widget, { kind: K }>;
  ctx: WidgetContext;
};

type FrameEnvironment = {
  editing: boolean;
  controls: ReactNode;
  onAsk?: (prompt: string) => void;
};

export const FrameContext = createContext<FrameEnvironment>({
  editing: false,
  controls: null,
});

export function WidgetFrame({
  label,
  subtitle,
  ask,
  actions,
  foot,
  className,
  children,
}: {
  label: string;
  subtitle?: ReactNode;
  ask?: string;
  actions?: ReactNode;
  foot?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const { editing, controls, onAsk } = use(FrameContext);
  return (
    <section className={cn("section desk-widget", className)}>
      <header className="section-head">
        <div>
          <h2>{label}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        <div className="row-actions">
          {editing ? (
            controls
          ) : (
            <>
              {actions}
              {onAsk && ask ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Ask about ${label.toLowerCase()}`}
                  title="Ask about this"
                  onClick={() => onAsk(ask)}
                >
                  <MessageSquareText />
                </Button>
              ) : null}
            </>
          )}
        </div>
      </header>
      <div className="section-body desk-body">{children}</div>
      {foot ? <footer className="section-foot">{foot}</footer> : null}
    </section>
  );
}

export function SkeletonRows({
  rows,
  label = "Loading",
}: {
  rows: number;
  label?: string;
}) {
  return (
    <div className="desk-skeleton" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index}>
          <i className="skeleton" />
        </span>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function DeskEmpty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty desk-empty">
      <strong>{title}</strong>
      {children ? <div>{children}</div> : null}
      {action ? <div className="desk-empty-action">{action}</div> : null}
    </div>
  );
}

export function SymbolButton({
  symbol,
  onOpen,
  className,
}: {
  symbol: string;
  onOpen: (symbol: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn("desk-symbol", className)}
      onClick={() => onOpen(symbol)}
      title={`Open ${symbol}`}
    >
      {symbol}
    </button>
  );
}

const subscribeNever = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

let clockValue = 0;
const clockSubscribe = (notify: () => void) => {
  const timer = setInterval(() => {
    clockValue = Date.now();
    notify();
  }, 60_000);
  return () => clearInterval(timer);
};
const clockSnapshot = () => {
  if (!clockValue) clockValue = Date.now();
  return clockValue;
};

export function useNow() {
  return useSyncExternalStore(clockSubscribe, clockSnapshot, () => 0);
}

export function useLocalDate() {
  return useSyncExternalStore(subscribeNever, today, () => null);
}

const clockFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayClockFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function Stamp({ ms, prefix }: { ms: number; prefix?: string }) {
  const hydrated = useHydrated();
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  const sameDay = hydrated && date.toDateString() === new Date().toDateString();
  return (
    <time dateTime={date.toISOString()}>
      {prefix ? `${prefix} ` : ""}
      {hydrated
        ? (sameDay ? clockFormat : dayClockFormat).format(date)
        : date.toISOString().slice(0, 16).replace("T", " ")}
    </time>
  );
}

export function latestTime(times: number[]) {
  const finite = times.filter((time) => Number.isFinite(time) && time > 0);
  return finite.length ? Math.max(...finite) * 1000 : null;
}

export function parseSymbols(text: string) {
  return [
    ...new Set(
      text
        .toUpperCase()
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
