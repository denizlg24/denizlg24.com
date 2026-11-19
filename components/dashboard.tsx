"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  ChartNoAxesCombined,
  CircleHelp,
  Command,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  Search,
  Settings2,
  Sparkles,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api, Empty, Failure, Loading, SourceLink } from "./shared";
import { Benchmarks, ChartPanel, MarketMap, useSearch } from "./market-widgets";
import { AddSymbolDialog, ListEditor } from "./watchlists";
import { Field, value, type Save } from "./forms";
import type { Workspace } from "@/lib/models";
import type { WorkspaceRecord } from "@/lib/db";
import { symbolPattern, type Universe } from "@/lib/universes";
import type { ResearchTab } from "./research";
import {
  dashboardFromHash,
  dashboardFromResult,
  dashboardLink,
  type AssistantResult,
  type DashboardState,
} from "@/lib/assistant-types";

const ComparePanel = dynamic(() => import("./comparison"), {
  ssr: false,
  loading: () => <Loading />,
});
const Portfolio = dynamic(
  () => import("./portfolio").then((module) => module.Portfolio),
  { loading: () => <Loading /> },
);
const Research = dynamic(
  () => import("./research").then((module) => module.Research),
  { loading: () => <Loading /> },
);
const Watchlists = dynamic(
  () => import("./watchlists").then((module) => module.Watchlists),
  { loading: () => <Loading /> },
);
const Alerts = dynamic(
  () => import("./alerts").then((module) => module.Alerts),
  { loading: () => <Loading /> },
);

const nav = [
  { view: "overview", label: "Overview", icon: LayoutDashboard },
  { view: "markets", label: "Markets", icon: Activity },
  { view: "watchlists", label: "Watchlists", icon: Star },
  { view: "portfolio", label: "Portfolio", icon: Wallet },
  { view: "research", label: "Research", icon: Newspaper },
  { view: "alerts", label: "Alerts", icon: Bell },
  { view: "settings", label: "Settings", icon: Settings2 },
] as const;
type View = (typeof nav)[number]["view"];
const descriptions: Record<View, string> = {
  overview: "Build a dashboard by asking for a market, company, or portfolio.",
  markets: "Explore market groups, session movers, and price history.",
  watchlists: "Organize the companies and funds you follow.",
  portfolio: "Track positions, transactions, and performance by currency.",
  research:
    "Company news, SEC filings, institutional holdings, and your notes.",
  alerts: "Track the prices you want to follow up on.",
  settings: "Set your opening view, appearance, and refresh preferences.",
};
const suggestions = [
  "Show me the S&P 500",
  "Warren Buffett’s portfolio",
  "What is WallStreetBets talking about?",
  "Healthcare stocks",
  "Chips",
  "Magnificent 7",
  "Show the Russian market",
  "DAX",
];
const subscribeNothing = () => () => undefined;
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
});
function dayLabel() {
  return dateFormatter.format(new Date());
}
function watchHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function readHash() {
  return window.location.hash.slice(1);
}
const noHash = () => "";

function SearchDialog({
  close,
  choose,
}: {
  close: () => void;
  choose: (ticker: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [queryKey, setQueryKey] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQueryKey(query.trim()), 260);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, error, isLoading } = useSearch(queryKey);
  const ticker = query.trim().toUpperCase();
  const result = data?.instruments ?? [];
  const exact =
    symbolPattern.test(ticker) &&
    !result.some((item) => item.symbol === ticker);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="search-dialog">
        <DialogHeader>
          <DialogTitle>Find a symbol</DialogTitle>
          <DialogDescription>
            Search by company name, ticker, or index.
          </DialogDescription>
        </DialogHeader>
        <form
          className="search-form"
          onSubmit={(event) => {
            event.preventDefault();
            const match =
              result.find((item) => item.symbol === ticker)?.symbol ??
              result[0]?.symbol ??
              (exact ? ticker : "");
            if (match) choose(match);
          }}
        >
          <Search size={17} />
          <Input
            aria-label="Symbol or company name"
            placeholder="Apple, ASML.AS, S&P 500…"
            value={query}
            maxLength={100}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
        </form>
        <Failure error={error} />
        {isLoading ? (
          <Loading message="Searching symbols" />
        ) : (
          <div className="search-results">
            {result.map((item) => (
              <button key={item.symbol} onClick={() => choose(item.symbol)}>
                <span>
                  <strong>{item.symbol}</strong>
                  <small>{item.name}</small>
                </span>
                <span>
                  {item.exchange ?? item.type ?? ""} <ArrowUpRight size={15} />
                </span>
              </button>
            ))}
            {exact ? (
              <button onClick={() => choose(ticker)}>
                <span>
                  <strong>Open {ticker}</strong>
                  <small>Look up this ticker directly</small>
                </span>
                <ArrowRight size={15} />
              </button>
            ) : null}
            {!query ? (
              <Empty title="Find your next company">
                Use the exchange suffix for listings such as ASML.AS or SAP.DE.
              </Empty>
            ) : null}
            {queryKey && !result.length && !exact && !error ? (
              <Empty title="No symbols found">
                Try another name or the exchange’s ticker.
              </Empty>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Conversation = {
  query: string;
  result: AssistantResult;
  web: boolean;
  symbol: string;
  dashboard?: DashboardState;
};
function Assistant({
  close,
  ticker,
  currentDashboard,
  navigate,
  saved,
  save,
  webResearch,
}: {
  close?: () => void;
  ticker: string;
  currentDashboard?: DashboardState;
  navigate: (result: AssistantResult) => void;
  saved: Workspace["requests"];
  save: Save;
  webResearch: boolean;
}) {
  const [query, setQuery] = useState("");
  const [useWeb, setUseWeb] = useState(false);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();
  const latest = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (history.length) latest.current?.scrollIntoView({ block: "nearest" });
  }, [history.length]);
  async function ask(
    text: string,
    web = useWeb,
    symbol = ticker,
    dashboard = currentDashboard,
  ) {
    if (!text.trim() || working) return;
    setQuery(text);
    setWorking(true);
    setError(undefined);
    try {
      const result = await api<AssistantResult>("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, symbol, web, dashboard }),
      });
      setHistory((items) => [
        ...items,
        { query: text, result, web, symbol, dashboard },
      ]);
      navigate(result);
      setQuery("");
    } catch (error) {
      setError(error as Error);
    } finally {
      setWorking(false);
    }
  }
  function bookmark(item: Conversation) {
    void save((workspace) => ({
      ...workspace,
      requests: [
        ...workspace.requests,
        {
          id: crypto.randomUUID(),
          query: item.query,
          answer: item.result.answer.slice(0, 8000),
          web: item.web,
          symbol: item.symbol,
          dashboard: item.dashboard,
          sources: (item.result.sources ?? [])
            .filter((source) => source.url.length <= 2500)
            .map((source) => ({
              title: source.title.slice(0, 500),
              url: source.url,
            })),
        },
      ],
    })).catch((error: Error) => setError(error));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(query);
  }
  return (
    <section className="panel assistant-dock" aria-labelledby="assistant-title">
      <div className="panel-heading">
        <div>
          <h2 id="assistant-title">
            <Sparkles size={17} /> Ask Stockwatcher
          </h2>
          <p>
            {currentDashboard
              ? "Follow up to change the dashboard."
              : "Choose an example or ask your own question."}
          </p>
        </div>
        {close ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide assistant"
            onClick={close}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <div className="assistant-body">
        {history.map((item, index) => (
          <div
            className="conversation"
            key={index}
            ref={index === history.length - 1 ? latest : null}
          >
            <p className="conversation-query">{item.query}</p>
            <div className="conversation-answer">
              <p className="assistant-answer-text">{item.result.answer}</p>
              {item.result.sources?.length ? (
                <ul>
                  {item.result.sources.map((source, index) => (
                    <li key={index}>
                      <SourceLink href={source.url}>{source.title}</SourceLink>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="row-actions">
                {dashboardFromResult(item.result) ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={dashboardLink(dashboardFromResult(item.result)!)}>
                      Open dashboard <ArrowRight />
                    </a>
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => bookmark(item)}
                  disabled={
                    saved.some(
                      (entry) =>
                        entry.query === item.query &&
                        entry.web === item.web &&
                        entry.symbol === item.symbol,
                    ) || saved.length >= 40
                  }
                >
                  <Bookmark />{" "}
                  {saved.some(
                    (entry) =>
                      entry.query === item.query &&
                      entry.web === item.web &&
                      entry.symbol === item.symbol,
                  )
                    ? "Saved"
                    : "Save request"}
                </Button>
              </div>
            </div>
          </div>
        ))}
        {!history.length ? (
          <div className="suggestions">
            {suggestions.map((text) => (
              <Button
                key={text}
                variant="outline"
                size="sm"
                disabled={working}
                onClick={() => void ask(text, false)}
              >
                {text} <ArrowUpRight />
              </Button>
            ))}
          </div>
        ) : null}
        {saved.length ? (
          <details className="saved-requests">
            <summary>Saved requests ({saved.length})</summary>
            {saved.map((item) => (
              <div key={item.id}>
                <details className="saved-answer">
                  <summary>{item.query}</summary>
                  <p className="assistant-answer-text">{item.answer}</p>
                  {item.sources.length ? (
                    <ul>
                      {item.sources.map((source) => (
                        <li key={source.url}>
                          <SourceLink href={source.url}>
                            {source.title}
                          </SourceLink>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={working || (item.web && !webResearch)}
                    onClick={() =>
                      void ask(
                        item.query,
                        item.web,
                        item.symbol ?? ticker,
                        item.dashboard,
                      )
                    }
                  >
                    {item.web ? "Run web research again" : "Run again"}
                  </Button>
                </details>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove saved request ${item.query}`}
                  onClick={() =>
                    void save((workspace) => ({
                      ...workspace,
                      requests: workspace.requests.filter(
                        (entry) => entry.id !== item.id,
                      ),
                    })).catch((error: Error) => setError(error))
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
          </details>
        ) : null}
      </div>
      <Failure error={error} />
      {webResearch ? (
        <label className="check-field assistant-web">
          <input
            type="checkbox"
            checked={useWeb}
            onChange={(event) => setUseWeb(event.target.checked)}
          />{" "}
          Research the web with Claude{" "}
          <small>
            Sends your question and chart symbol to Claude through Vercel AI
            Gateway.
          </small>
        </label>
      ) : null}
      <form className="assistant-input" onSubmit={submit}>
        <Input
          aria-label="Request"
          placeholder="Ask about a market or company…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={500}
          id="assistant-request"
        />
        <Button type="submit" disabled={working || !query.trim()}>
          {working ? "Looking up…" : "Ask"} <ArrowRight />
        </Button>
      </form>
    </section>
  );
}

function Settings({
  workspace,
  account,
  save,
}: {
  workspace: Workspace;
  account: { name: string; email: string | null; demo: boolean };
  save: Save;
}) {
  const [error, setError] = useState<Error>();
  const [success, setSuccess] = useState("");
  const [working, setWorking] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setWorking(true);
    setError(undefined);
    setSuccess("");
    try {
      await save((current) => ({
        ...current,
        settings: {
          theme: value(fields, "theme") as Workspace["settings"]["theme"],
          home: value(fields, "home") as Workspace["settings"]["home"],
          refresh: fields.has("refresh"),
        },
      }));
      setSuccess("Preferences saved.");
    } catch (error) {
      setError(error as Error);
    } finally {
      setWorking(false);
    }
  }
  function exportWorkspace() {
    const backup = {
      format: "stockwatcher",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `stockwatcher-backup-${backup.exportedAt.slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return (
    <div className="settings-grid">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Preferences</h2>
            <p>Saved to your workspace.</p>
          </div>
        </div>
        <form className="form-stack settings-form" onSubmit={submit}>
          <Field label="Appearance">
            <select name="theme" defaultValue={workspace.settings.theme}>
              <option value="system">Follow device</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
          <Field label="Opening view">
            <select name="home" defaultValue={workspace.settings.home}>
              {nav
                .filter((item) =>
                  ["overview", "markets", "portfolio", "research"].includes(
                    item.view,
                  ),
                )
                .map((item) => (
                  <option key={item.view} value={item.view}>
                    {item.label}
                  </option>
                ))}
            </select>
          </Field>
          <label className="check-field">
            <input
              type="checkbox"
              name="refresh"
              defaultChecked={workspace.settings.refresh}
            />{" "}
            Automatically refresh visible quotes
          </label>
          <Failure error={error} />
          {success ? (
            <p className="positive" role="status">
              {success}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={working}>
              {working ? "Saving…" : "Save preferences"}
            </Button>
          </div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Account</h2>
            <p>{account.demo ? "Preview workspace" : "Deniz Cloud"}</p>
          </div>
        </div>
        <div className="account-detail">
          <strong>{account.name}</strong>
          {account.email ? <span>{account.email}</span> : null}
          <form action="/auth/logout" method="post">
            <Button variant="outline" type="submit">
              <LogOut /> Sign out
            </Button>
          </form>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Workspace backup</h2>
            <p>
              Download a copy of your watchlists, portfolios, research, and
              alerts.
            </p>
          </div>
        </div>
        <div className="account-detail">
          <Button
            className="justify-self-start"
            variant="outline"
            onClick={exportWorkspace}
          >
            Download workspace JSON
          </Button>
        </div>
      </section>
    </div>
  );
}

export function Dashboard({
  initial,
  account,
  monitoring,
  webResearch,
}: {
  initial: WorkspaceRecord;
  account: { name: string; email: string | null; demo: boolean };
  monitoring: boolean;
  webResearch: boolean;
}) {
  const { data: record = initial, mutate } = useSWR<WorkspaceRecord>(
    "/api/workspace",
    api,
    { fallbackData: initial, refreshInterval: 45_000 },
  );
  const workspace = record.data;
  const hash = useSyncExternalStore(watchHash, readHash, noHash);
  const explicit = dashboardFromHash(hash);
  const recent = workspace.dashboard;
  const view =
    nav.find((item) => item.view === hash.split("?")[0])?.view ??
    recent?.view ??
    workspace.settings.home;
  const viewState = explicit ?? (recent?.view === view ? recent : undefined);
  const ticker = viewState?.ticker ?? viewState?.symbols?.[0] ?? "^GSPC";
  const custom = viewState?.symbols ?? [];
  const universe =
    viewState?.universe ?? (viewState?.symbols ? undefined : "US & Europe");
  const tab = viewState?.researchTab ?? "company";
  const cik = viewState?.cik ?? "1067983";
  const since = viewState?.since;
  const marketState: DashboardState = {
    ...viewState,
    view: "markets",
    ticker,
    universe,
    symbols: viewState?.symbols,
  };
  const [watchlist, setWatchlist] = useState(
    initial.data.watchlists[0]?.id ?? "",
  );
  const [search, setSearch] = useState(false);
  const [assistant, setAssistant] = useState<boolean | null>(null);
  const showAssistant =
    view === "overview" || (assistant ?? Boolean(viewState));
  const [modal, setModal] = useState<"symbol" | "list" | null>(null);
  const [addTicker, setAddTicker] = useState<string>();
  const [proposed, setProposed] = useState<NonNullable<
    AssistantResult["alert"]
  > | null>(null);
  const [mobile, setMobile] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const notify = useCallback(
    (text: string, error = false) => setNotice({ text, error }),
    [],
  );
  const date = useSyncExternalStore(subscribeNothing, dayLabel, noHash);
  const enabled = workspace.settings.refresh;
  const triggered = workspace.alerts.filter(
    (item) => !item.enabled && item.lastTriggered,
  ).length;
  const shortlist = workspace.watchlists[0];
  const watched = shortlist?.symbols.includes(ticker) ?? false;
  useEffect(() => {
    document.documentElement.dataset.theme = workspace.settings.theme;
  }, [workspace.settings.theme]);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearch(true);
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 5500);
    return () => clearTimeout(timer);
  }, [notice]);
  const save: Save = useCallback(
    async (update) => {
      try {
        await mutate(
          async (current = initial) =>
            api<WorkspaceRecord>("/api/workspace", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                revision: current.revision,
                data: update(current.data),
              }),
            }),
          { revalidate: false, throwOnError: true },
        );
      } catch (error) {
        if ((error as { status?: number }).status === 409) await mutate();
        throw error;
      }
    },
    [initial, mutate],
  );
  function link(state: DashboardState) {
    const hash = dashboardLink(state);
    if (window.location.hash !== hash) window.location.hash = hash;
  }
  function jump(destination: View) {
    setMobile(false);
    if (readHash() !== destination) window.location.hash = destination;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function choose(ticker: string) {
    link(
      view === "markets"
        ? { ...marketState, ticker }
        : { view: "markets", ticker, symbols: [ticker] },
    );
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function researchSymbol() {
    link({ view: "research", ticker, researchTab: "company" });
  }
  function chooseUniverse(universe: Universe) {
    link({ view: "markets", ticker, universe, since });
  }
  function toggleAssistant() {
    setMobile(false);
    setAssistant(true);
    requestAnimationFrame(() =>
      document.getElementById("assistant-request")?.focus(),
    );
  }
  function addSymbol(symbol?: string) {
    setAddTicker(symbol);
    setModal(workspace.watchlists.length ? "symbol" : "list");
  }
  function toggleWatch() {
    if (!shortlist) {
      void save((next) => ({
        ...next,
        watchlists: [
          ...next.watchlists,
          { id: crypto.randomUUID(), name: "My watchlist", symbols: [ticker] },
        ],
      }))
        .then(() => notify(`${ticker} added to My watchlist.`))
        .catch((error: Error) => notify(error.message, true));
      return;
    }
    void save((next) => ({
      ...next,
      watchlists: next.watchlists.map((item) =>
        item.id === shortlist.id
          ? {
              ...item,
              symbols: watched
                ? item.symbols.filter((symbol) => symbol !== ticker)
                : [...new Set([...item.symbols, ticker])],
            }
          : item,
      ),
    }))
      .then(() =>
        notify(
          watched
            ? `${ticker} removed from ${shortlist.name}.`
            : `${ticker} added to ${shortlist.name}.`,
        ),
      )
      .catch((error: Error) => notify(error.message, true));
  }
  function openRequest(result: AssistantResult) {
    const state = dashboardFromResult(result);
    if (!state) return;
    if (result.alert) setProposed(result.alert);
    setAssistant(true);
    link(state);
    void save((next) => ({ ...next, dashboard: state })).catch((error: Error) =>
      notify(error.message, true),
    );
  }
  const chart =
    viewState?.symbols?.length === 0 && !universe ? null : (
      <ChartPanel
        ticker={ticker}
        refresh={enabled}
        watch={watched}
        onWatch={toggleWatch}
        onResearch={researchSymbol}
        since={since}
        clearSince={() => link({ ...marketState, since: undefined })}
      />
    );
  return (
    <div className="app-shell">
      <a
        href="#workspace-main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("workspace-main")?.focus();
        }}
      >
        Skip to workspace
      </a>
      {mobile ? (
        <button
          className="mobile-scrim"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      ) : null}
      <aside
        className={`sidebar ${mobile ? "sidebar-open" : ""}`}
        aria-label="Sidebar"
      >
        <a href="#overview" className="brand" onClick={() => jump("overview")}>
          <span className="brand-mark">
            <ChartNoAxesCombined size={19} />
          </span>
          <span>Stockwatcher</span>
        </a>
        <div className="sidebar-content">
          <div className="nav-label">Workspace</div>
          <nav aria-label="Workspace">
            {nav
              .slice(0, -1)
              .map(({ view: destination, label, icon: Icon }) => (
                <a
                  key={destination}
                  href={`#${destination}`}
                  onClick={() => jump(destination)}
                  className={view === destination ? "active" : ""}
                  aria-current={view === destination ? "page" : undefined}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  {destination === "alerts" && triggered ? (
                    <b className="nav-count">{triggered}</b>
                  ) : null}
                </a>
              ))}
          </nav>
          <div className="nav-label tools-label">Preferences</div>
          <nav aria-label="Preferences">
            <a
              href="#settings"
              onClick={() => jump("settings")}
              className={view === "settings" ? "active" : ""}
              aria-current={view === "settings" ? "page" : undefined}
            >
              <Settings2 size={17} />
              <span>Settings</span>
            </a>
            <button onClick={toggleAssistant}>
              <CircleHelp size={17} />
              <span>Ask Stockwatcher</span>
            </button>
          </nav>
        </div>
        <a
          href="#settings"
          onClick={() => jump("settings")}
          className="sidebar-account"
        >
          <span className="avatar">
            {account.name.trim().slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{account.name}</strong>
            <small>
              {account.demo ? "Preview workspace" : "Deniz Cloud account"}
            </small>
          </span>
          <ArrowUpRight size={14} />
        </a>
      </aside>
      <div className="workbench">
        <header className="topbar">
          <div className="topbar-context">
            <Button
              variant="ghost"
              size="icon-sm"
              className="menu-button"
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(!mobile)}
            >
              <Menu />
            </Button>
            <span>Workspace</span>
            <span className="crumb-separator">/</span>
            <strong>{nav.find((item) => item.view === view)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <Button
              variant="outline"
              className="global-search"
              aria-label="Search symbols"
              onClick={() => setSearch(true)}
            >
              <Search />
              <span>Search symbols</span>
              <kbd>
                <Command size={12} /> K
              </kbd>
            </Button>
            <Button className="ask-button" onClick={toggleAssistant}>
              <Sparkles />
              <span>Ask Stockwatcher</span>
            </Button>
          </div>
        </header>
        <main className="workbench-content" id="workspace-main" tabIndex={-1}>
          <div className="view-header">
            <div>
              <h1>
                {view === "overview"
                  ? "What would you like to see?"
                  : nav.find((item) => item.view === view)?.label}
              </h1>
              <p>{descriptions[view]}</p>
            </div>
            {view === "markets" ? (
              <div className="market-date">
                <span>{date || " "}</span>
                <Badge variant="secondary">
                  <i /> Delayed market data
                </Badge>
              </div>
            ) : null}
          </div>
          <div
            className={`dashboard-layout ${showAssistant && view !== "overview" ? "with-assistant" : ""}`}
          >
            <div hidden={!showAssistant} className="assistant-column">
              <Assistant
                close={
                  view === "overview" ? undefined : () => setAssistant(false)
                }
                ticker={ticker}
                currentDashboard={view === "markets" ? marketState : viewState}
                navigate={openRequest}
                saved={workspace.requests}
                save={save}
                webResearch={webResearch}
              />
            </div>
            {view !== "overview" ? (
              <div className="dashboard-result">
                {view === "markets" ? (
                  <div className="stack-layout">
                    {!viewState ? (
                      <Benchmarks
                        selected={ticker}
                        select={choose}
                        refresh={enabled}
                      />
                    ) : null}
                    {chart}
                    <MarketMap
                      universe={universe}
                      setUniverse={chooseUniverse}
                      custom={custom}
                      excluded={viewState?.excluded}
                      since={since}
                      select={choose}
                      refresh={enabled}
                    />
                    <ComparePanel
                      key={custom.length > 1 ? custom.join(",") : "empty"}
                      symbols={custom.slice(0, 6)}
                      apply={(symbols) =>
                        link({
                          view: "markets",
                          ticker: symbols[0],
                          symbols,
                          since,
                        })
                      }
                      since={since}
                    />
                  </div>
                ) : null}
                {view === "watchlists" ? (
                  <Watchlists
                    lists={workspace.watchlists}
                    listId={watchlist}
                    setList={setWatchlist}
                    add={() => addSymbol()}
                    save={save}
                    select={choose}
                    refresh={enabled}
                  />
                ) : null}
                {view === "portfolio" ? (
                  <Portfolio
                    workspace={workspace}
                    save={save}
                    select={choose}
                    refresh={enabled}
                  />
                ) : null}
                {view === "research" ? (
                  <Research
                    tab={tab}
                    setTab={(researchTab: ResearchTab) =>
                      link({
                        ...viewState,
                        view: "research",
                        ticker,
                        researchTab,
                        cik,
                      })
                    }
                    ticker={ticker}
                    refresh={enabled}
                    notes={workspace.notes}
                    save={save}
                    cik={cik}
                    setCik={(cik) =>
                      link({
                        ...viewState,
                        view: "research",
                        ticker,
                        researchTab: tab,
                        cik: cik || undefined,
                      })
                    }
                    select={choose}
                    onSearch={() => setSearch(true)}
                    onChart={() =>
                      link({ view: "markets", ticker, symbols: [ticker] })
                    }
                  />
                ) : null}
                {view === "alerts" ? (
                  <Alerts
                    alerts={workspace.alerts}
                    ticker={ticker}
                    save={save}
                    refresh={enabled}
                    demo={account.demo}
                    monitoring={monitoring}
                    select={choose}
                    proposed={proposed}
                    clearProposed={() => setProposed(null)}
                    notify={notify}
                  />
                ) : null}
                {view === "settings" ? (
                  <Settings
                    workspace={workspace}
                    account={account}
                    save={save}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          <footer className="workspace-footer">
            <span>Stockwatcher</span>
            <span>Times shown in your device’s time zone</span>
          </footer>
        </main>
      </div>
      {search ? (
        <SearchDialog
          close={() => setSearch(false)}
          choose={(symbol) => {
            setSearch(false);
            if (view === "research") {
              link({
                view: "research",
                ticker: symbol,
                researchTab: "company",
              });
            } else choose(symbol);
          }}
        />
      ) : null}
      {modal === "symbol" ? (
        <AddSymbolDialog
          lists={workspace.watchlists}
          listId={watchlist}
          initial={addTicker}
          close={() => setModal(null)}
          save={save}
        />
      ) : null}
      {modal === "list" ? (
        <ListEditor
          close={() => setModal(null)}
          save={save}
          created={setWatchlist}
        />
      ) : null}
      {notice ? (
        <div
          className={`toast ${notice.error ? "toast-error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
          <button
            onClick={() => setNotice(undefined)}
            aria-label="Dismiss message"
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
