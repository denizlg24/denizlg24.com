"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { z } from "zod";
import { dashboardFromHash } from "@/lib/assistant-types";
import { viewFromHash, viewLabel } from "./nav";

const STORE = "stockwatcher.panels";
const MAX_TABS = 12;
const tabsSchema = z.object({
  tabs: z.array(z.object({ id: z.string().max(64), hash: z.string().max(2000) })).max(MAX_TABS),
  active: z.string().max(64),
});
type Tabs = z.infer<typeof tabsSchema>;

export function panelLabel(hash: string) {
  const view = viewFromHash(hash) ?? "desk";
  const state = dashboardFromHash(hash);
  if (view === "security") return `${state?.ticker ?? ""} ${state?.fn ?? "GP"}`.trim();
  if (view === "monitor") {
    const symbols = state?.symbols?.length ? ` ${state.symbols.slice(0, 2).join(" ")}` : "";
    return `${state?.fn ?? "MOST"}${symbols}`;
  }
  if (view === "markets" && state?.ticker) return `MKT ${state.ticker}`;
  if (view === "overlay") return "G";
  return viewLabel(view);
}

function load(hash: string): Tabs {
  try {
    const parsed = tabsSchema.safeParse(JSON.parse(localStorage.getItem(STORE) ?? "null"));
    if (parsed.success && parsed.data.tabs.length) return parsed.data;
  } catch {}
  return { tabs: [{ id: "t1", hash }], active: "t1" };
}

function persist(state: Tabs) {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {}
}

/**
 * Browser-style panel tabs. The active tab follows navigation, so each tab
 * keeps its own security and function; switching restores that tab's view.
 */
export function PanelTabs({ hash }: { hash: string }) {
  const [state, setState] = useState<Tabs | null>(null);
  useEffect(() => {
    if (state) persist(state);
  }, [state]);
  useEffect(() => {
    // Tabs live in this browser only, so they load after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(load(window.location.hash.slice(1)));
  }, []);
  if (!state) return <div className="panel-tabs" aria-hidden />;
  return <Strip state={state} setState={setState} hash={hash} />;
}

function Strip({
  state,
  setState,
  hash,
}: {
  state: Tabs;
  setState: (next: Tabs) => void;
  hash: string;
}) {
  const update = setState;
  const go = (target: string) => {
    if (window.location.hash.slice(1) !== target) window.location.hash = target;
  };

  const activeHash = state.tabs.find((tab) => tab.id === state.active)?.hash;
  useEffect(() => {
    if (activeHash === hash) return;
    setState({
      ...state,
      tabs: state.tabs.map((tab) => (tab.id === state.active ? { ...tab, hash } : tab)),
    });
  }, [activeHash, hash, state, setState]);

  const open = (target: string) => {
    const id = crypto.randomUUID().slice(0, 8);
    const tabs = [...state.tabs, { id, hash: target }].slice(-MAX_TABS);
    update({ tabs, active: id });
    go(target);
  };
  const select = (id: string) => {
    const tab = state.tabs.find((item) => item.id === id);
    if (!tab) return;
    update({ ...state, active: id });
    go(tab.hash);
  };
  const close = (id: string) => {
    if (state.tabs.length === 1) return;
    const index = state.tabs.findIndex((tab) => tab.id === id);
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    const active = id === state.active ? tabs[Math.max(0, index - 1)].id : state.active;
    update({ tabs, active });
    if (id === state.active) go(tabs.find((tab) => tab.id === active)!.hash);
  };

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      const index = state.tabs.findIndex((tab) => tab.id === state.active);
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = state.tabs[(index + step + state.tabs.length) % state.tabs.length];
        select(next.id);
      } else if (event.key.toLowerCase() === "t" || event.code === "KeyT") {
        event.preventDefault();
        open(hash || "desk");
      } else if (event.key.toLowerCase() === "w" || event.code === "KeyW") {
        event.preventDefault();
        close(state.active);
      } else if (/^Digit[1-9]$/.test(event.code)) {
        const target = state.tabs[Number(event.code.slice(5)) - 1];
        if (target) {
          event.preventDefault();
          select(target.id);
        }
      }
    }
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  return (
    <div className="panel-tabs" role="tablist" aria-label="Open panels" data-tour="tabs">
      {state.tabs.map((tab, index) => (
        <div key={tab.id} className="panel-tab" data-active={tab.id === state.active || undefined}>
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === state.active}
            title={`${panelLabel(tab.hash)} (Alt+${index + 1})`}
            onClick={() => select(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) close(tab.id);
            }}
          >
            <span className="panel-tab-index">{index + 1}</span>
            {panelLabel(tab.hash)}
          </button>
          {state.tabs.length > 1 ? (
            <button type="button" className="panel-tab-close" aria-label={`Close ${panelLabel(tab.hash)}`} onClick={() => close(tab.id)}>
              <X size={11} />
            </button>
          ) : null}
        </div>
      ))}
      {state.tabs.length < MAX_TABS ? (
        <button
          type="button"
          className="panel-tab-new"
          aria-label="New panel (Alt+T)"
          title="New panel, a copy of this one (Alt+T)"
          onClick={() => open(hash || "desk")}
        >
          <Plus size={13} />
        </button>
      ) : null}
    </div>
  );
}
