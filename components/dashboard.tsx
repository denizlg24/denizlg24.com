"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { X } from "lucide-react";
import { api, Loading } from "./shared";
import { ChartPanel, MarketMap } from "./market-widgets";
import { AddSymbolDialog, ListEditor } from "./watchlists";
import type { Save } from "./forms";
import type { ResearchTab } from "./research";
import {
  AssistantPanel,
  type AlertProposal,
  type AssistantContext,
  type AssistantHandle,
} from "./assistant/assistant-panel";
import { Desk } from "./desk/desk";
import { CommandHelp } from "./shell/command-line";
import { useLiveStatus } from "./live-quotes";
import type { ChartPreferences } from "@/lib/models";
import { encodeOverlay } from "@/lib/overlay";
import {
  monitorFunctions,
  securityFunctions,
  type Command,
  type MonitorFunction,
  type SecurityFunction,
} from "@/lib/terminal";
import { LegacyAssistant } from "./shell/legacy-assistant";
import { SearchDialog } from "./shell/search-dialog";
import { Settings, type Account } from "./shell/settings";
import { Sidebar } from "./shell/sidebar";
import { Topbar } from "./shell/topbar";
import { useHash, useMediaQuery, useStoredFlag } from "./shell/hooks";
import { homeView, viewFromHash, viewLabel, type View } from "./shell/nav";
import type { WorkspaceRecord } from "@/lib/db";
import type { Universe } from "@/lib/universes";
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
const ReportsLibrary = dynamic(
  () => import("./reports/library").then((module) => module.ReportsLibrary),
  { loading: () => <Loading /> },
);
const SecurityView = dynamic(
  () =>
    import("./security/security-view").then((module) => module.SecurityView),
  { loading: () => <Loading /> },
);
const OverlayView = dynamic(
  () => import("./overlay/overlay-view").then((module) => module.OverlayView),
  { loading: () => <Loading /> },
);
const Monitor = dynamic(
  () => import("./security/monitor").then((module) => module.Monitor),
  { loading: () => <Loading /> },
);
const MemoryPanel = dynamic(
  () => import("./assistant/memory-panel").then((module) => module.MemoryPanel),
  { loading: () => <Loading /> },
);

const mobileQuery = "(max-width: 980px)";
const securityFn = (value?: string): SecurityFunction =>
  securityFunctions.find((item) => item.code === value)?.code ?? "GP";
const monitorFn = (value?: string): MonitorFunction =>
  monitorFunctions.find((item) => item.code === value)?.code ?? "MOST";

export function Dashboard({
  initial,
  account,
  monitoring,
  aiEnabled,
}: {
  initial: WorkspaceRecord;
  account: Account;
  monitoring: boolean;
  aiEnabled: boolean;
}) {
  const { data: record = initial, mutate } = useSWR<WorkspaceRecord>(
    "/api/workspace",
    api,
    { fallbackData: initial, refreshInterval: 45_000 },
  );
  const workspace = record.data;
  const hash = useHash();
  const view = viewFromHash(hash) ?? homeView(workspace.settings.home);
  const explicit = dashboardFromHash(hash);
  const recent = workspace.dashboard;
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
  const refresh = workspace.settings.refresh;

  const [watchlist, setWatchlist] = useState(
    initial.data.watchlists[0]?.id ?? "",
  );
  const [search, setSearch] = useState(false);
  const [help, setHelp] = useState(false);
  const liveStatus = useLiveStatus();
  const [modal, setModal] = useState<"symbol" | "list" | null>(null);
  const [proposed, setProposed] = useState<AlertProposal | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const [aiDown, setAiDown] = useState(false);
  const [docked, setDocked] = useStoredFlag("stockwatcher.assistant", true);
  const [sheet, setSheet] = useState(false);
  const mobile = useMediaQuery(mobileQuery);
  const assistantOpen = mobile ? sheet : docked;
  const useAI = aiEnabled && !aiDown;
  const assistant = useRef<AssistantHandle>(null);
  const main = useRef<HTMLElement>(null);

  const notify = useCallback(
    (text: string, error = false) => setNotice({ text, error }),
    [],
  );
  const triggered = workspace.alerts.filter(
    (item) => !item.enabled && item.lastTriggered,
  ).length;
  const shortlist = workspace.watchlists[0];
  const watched = shortlist?.symbols.includes(ticker) ?? false;

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
        if (
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409
        )
          await mutate();
        throw error;
      }
    },
    [initial, mutate],
  );

  const toTop = () => main.current?.scrollTo({ top: 0, behavior: "instant" });
  const link = useCallback((state: DashboardState) => {
    const next = dashboardLink(state);
    if (window.location.hash !== next) window.location.hash = next;
    main.current?.scrollTo({ top: 0, behavior: "instant" });
  }, []);
  const remember = useCallback(
    (state: DashboardState) =>
      void save((next) => ({ ...next, dashboard: state })).catch(
        (error: Error) => notify(error.message, true),
      ),
    [save, notify],
  );
  function go(destination: View) {
    setNavOpen(false);
    if (window.location.hash.slice(1) !== destination)
      window.location.hash = destination;
    toTop();
  }
  function choose(symbol: string) {
    link(
      view === "markets"
        ? { ...marketState, ticker: symbol }
        : {
            view: "security",
            ticker: symbol,
            fn: view === "security" ? securityFn(viewState?.fn) : "GP",
          },
    );
  }
  const savePreferences = useCallback(
    async (chart: ChartPreferences) => {
      try {
        await save((next) => ({
          ...next,
          settings: { ...next.settings, chart },
        }));
        notify("Chart defaults saved.");
      } catch (error) {
        notify((error as Error).message, true);
      }
    },
    [save, notify],
  );
  function runCommand(command: Command) {
    setNavOpen(false);
    if (command.kind === "help") setHelp(true);
    else if (command.kind === "search") setSearch(true);
    else if (command.kind === "view") go(command.view);
    else if (command.kind === "monitor") link({ view: "monitor", fn: command.fn });
    else if (command.kind === "overlay")
      link({
        view: "overlay",
        spec: command.series.length
          ? encodeOverlay(
              command.series.map((expr, index) => ({
                expr,
                axis: index === 0 ? "left" : "right",
                mode: command.series.length > 2 ? "rebased" : "price",
                invert: false,
                studies: [],
              })),
            )
          : viewState?.spec,
        period: viewState?.period,
      });
    else
      openView({
        view: "security",
        ticker: command.ticker,
        fn: command.fn,
      });
  }

  const openAssistant = useCallback(() => {
    setNavOpen(false);
    if (window.matchMedia(mobileQuery).matches) setSheet(true);
    else setDocked(true);
    requestAnimationFrame(() => assistant.current?.focus());
  }, [setDocked]);
  const closeAssistant = useCallback(() => {
    setSheet(false);
    if (!window.matchMedia(mobileQuery).matches) setDocked(false);
  }, [setDocked]);
  const toggleAssistant = useCallback(() => {
    if (assistantOpen) closeAssistant();
    else openAssistant();
  }, [assistantOpen, closeAssistant, openAssistant]);

  useEffect(() => {
    document.documentElement.dataset.theme = workspace.settings.theme;
  }, [workspace.settings.theme]);
  useEffect(() => {
    void fetch("/auth/renew", { method: "POST" }).catch(() => undefined);
  }, []);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setSearch(true);
      } else if (key === "j") {
        event.preventDefault();
        toggleAssistant();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [toggleAssistant]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 5500);
    return () => clearTimeout(timer);
  }, [notice]);

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
    setSheet(false);
    link(state);
    remember(state);
  }
  const openView = useCallback(
    (state: DashboardState) => {
      setSheet(false);
      link(state);
      remember(state);
    },
    [link, remember],
  );
  const proposeAlert = useCallback(
    (proposal: AlertProposal) => {
      setProposed(proposal);
      setSheet(false);
      link({ view: "alerts", ticker: proposal.symbol });
    },
    [link],
  );
  const deskChanged = useCallback(() => void mutate(), [mutate]);
  const unavailable = useCallback(() => setAiDown(true), []);
  const ask = useCallback(
    (prompt: string) => {
      openAssistant();
      assistant.current?.send(prompt);
    },
    [openAssistant],
  );

  const currentDashboard =
    view === "markets"
      ? marketState
      : view === "security"
        ? { view: "security" as const, ticker, fn: securityFn(viewState?.fn) }
        : view === "overlay"
          ? { view: "overlay" as const, spec: viewState?.spec, period: viewState?.period }
        : view === "desk" ||
          view === "memory" ||
          view === "settings" ||
          view === "reports"
        ? undefined
        : (viewState ?? { view, ticker });
  const context: AssistantContext = {
    view,
    dashboard: currentDashboard,
    ticker: currentDashboard ? ticker : undefined,
  };

  return (
    <div
      className="app-shell"
      data-dock={docked ? "open" : "closed"}
      data-sheet={sheet ? "open" : "closed"}
    >
      <a
        href="#workspace-main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to workspace
      </a>
      <Topbar
        account={account}
        ticker={view === "markets" ? ticker : undefined}
        refresh={refresh}
        navOpen={navOpen}
        assistantOpen={assistantOpen}
        onMenu={() => setNavOpen(!navOpen)}
        onHome={() => go("desk")}
        onSearch={() => setSearch(true)}
        onAssistant={openAssistant}
        onSymbol={choose}
        onSettings={() => go("settings")}
        onMemory={() => go("memory")}
        security={
          view === "security" || view === "markets" || view === "research"
            ? ticker
            : undefined
        }
        onCommand={runCommand}
      />
      <Sidebar
        view={view}
        open={navOpen}
        badges={{ alerts: triggered }}
        go={go}
        close={() => setNavOpen(false)}
      />
      <main className="shell-main" id="workspace-main" ref={main} tabIndex={-1}>
        <div className="shell-content">
          <header className="view-header">
            <h1>
              {view === "security"
                ? `${ticker} ${securityFn(viewState?.fn)}`
                : view === "monitor"
                  ? monitorFn(viewState?.fn)
                  : view === "overlay"
                    ? "G · Overlay"
                    : viewLabel(view)}
            </h1>
            {view === "markets" || view === "security" ? (
              <span className="meta">
                {liveStatus === "live"
                  ? "Streaming quotes · history from Yahoo Finance"
                  : "Exchange-delayed quotes · Yahoo Finance"}
              </span>
            ) : null}
          </header>
          {view === "desk" ? (
            <Desk
              workspace={workspace}
              save={save}
              refresh={refresh}
              aiEnabled={useAI}
              onOpenSymbol={choose}
              onOpenView={openView}
              onAsk={ask}
            />
          ) : null}
          {view === "markets" ? (
            <div className="stack-layout">
              {viewState?.symbols?.length === 0 && !universe ? null : (
                <ChartPanel
                  key={ticker}
                  ticker={ticker}
                  refresh={refresh}
                  watch={watched}
                  onWatch={toggleWatch}
                  onResearch={() =>
                    link({ view: "research", ticker, researchTab: "company" })
                  }
                  onFunction={(fn) => link({ view: "security", ticker, fn })}
                  preferences={workspace.settings.chart}
                  savePreferences={savePreferences}
                  since={since}
                  clearSince={() => link({ ...marketState, since: undefined })}
                />
              )}
              <MarketMap
                universe={universe}
                setUniverse={(next: Universe) =>
                  link({ view: "markets", ticker, universe: next, since })
                }
                custom={custom}
                excluded={viewState?.excluded}
                since={since}
                select={choose}
                refresh={refresh}
              />
              <ComparePanel
                key={custom.length > 1 ? custom.join(",") : "empty"}
                symbols={custom.slice(0, 6)}
                apply={(symbols) =>
                  link({ view: "markets", ticker: symbols[0], symbols, since })
                }
                since={since}
              />
            </div>
          ) : null}
          {view === "security" ? (
            <SecurityView
              ticker={ticker}
              fn={securityFn(viewState?.fn)}
              setFn={(fn) => link({ view: "security", ticker, fn })}
              refresh={refresh}
              preferences={workspace.settings.chart}
              savePreferences={savePreferences}
              watch={watched}
              onWatch={toggleWatch}
              onResearch={() =>
                link({ view: "research", ticker, researchTab: "company" })
              }
              select={(symbol) =>
                link({ view: "security", ticker: symbol, fn: "GP" })
              }
              openFunction={(symbol, fn) =>
                link({ view: "security", ticker: symbol, fn })
              }
            />
          ) : null}
          {view === "monitor" ? (
            <Monitor
              fn={monitorFn(viewState?.fn)}
              setFn={(fn) => link({ view: "monitor", fn })}
              select={(symbol) =>
                link({ view: "security", ticker: symbol, fn: "GP" })
              }
              refresh={refresh}
            />
          ) : null}
          {view === "overlay" ? (
            <OverlayView
              spec={viewState?.spec}
              period={viewState?.period}
              onChange={(spec, period) =>
                link({ view: "overlay", spec, period })
              }
              workspace={workspace}
              save={save}
              notify={notify}
            />
          ) : null}
          {view === "watchlists" ? (
            <Watchlists
              lists={workspace.watchlists}
              listId={watchlist}
              setList={setWatchlist}
              add={() =>
                setModal(workspace.watchlists.length ? "symbol" : "list")
              }
              save={save}
              select={choose}
              refresh={refresh}
            />
          ) : null}
          {view === "portfolio" ? (
            <Portfolio
              workspace={workspace}
              save={save}
              select={choose}
              refresh={refresh}
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
              refresh={refresh}
              notes={workspace.notes}
              save={save}
              cik={cik}
              setCik={(next) =>
                link({
                  ...viewState,
                  view: "research",
                  ticker,
                  researchTab: tab,
                  cik: next || undefined,
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
              refresh={refresh}
              demo={account.demo}
              monitoring={monitoring}
              select={choose}
              proposed={proposed}
              clearProposed={() => setProposed(null)}
              notify={notify}
            />
          ) : null}
          {view === "reports" ? (
            <ReportsLibrary onAsk={useAI ? ask : undefined} />
          ) : null}
          {view === "memory" ? <MemoryPanel /> : null}
          {view === "settings" ? (
            <Settings workspace={workspace} account={account} save={save} />
          ) : null}
          <footer className="workspace-footer">
            <span>
              {liveStatus === "live"
                ? "Live quotes streaming; history and fundamentals from Yahoo Finance"
                : "Quotes are exchange-delayed when the live feed is off"}
            </span>
            <span>Times shown in your device’s time zone</span>
          </footer>
        </div>
      </main>
      <aside
        className="dock"
        id="assistant-dock"
        aria-label="Assistant"
        data-open={assistantOpen || undefined}
      >
        {useAI ? (
          <AssistantPanel
            ref={assistant}
            context={context}
            onOpenView={openView}
            onProposeAlert={proposeAlert}
            onDeskChanged={deskChanged}
            onOpenSymbol={choose}
            onClose={closeAssistant}
            onUnavailable={unavailable}
          />
        ) : (
          <LegacyAssistant
            ref={assistant}
            close={closeAssistant}
            ticker={ticker}
            currentDashboard={currentDashboard}
            navigate={openRequest}
            saved={workspace.requests}
            save={save}
          />
        )}
      </aside>
      {search ? (
        <SearchDialog
          close={() => setSearch(false)}
          choose={(symbol) => {
            setSearch(false);
            if (view === "research")
              link({
                view: "research",
                ticker: symbol,
                researchTab: "company",
              });
            else choose(symbol);
          }}
        />
      ) : null}
      {help ? <CommandHelp close={() => setHelp(false)} /> : null}
      {modal === "symbol" ? (
        <AddSymbolDialog
          lists={workspace.watchlists}
          listId={watchlist}
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
            type="button"
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
