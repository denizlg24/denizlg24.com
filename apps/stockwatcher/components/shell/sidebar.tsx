"use client";

import { type ReactNode, useEffect } from "react";
import {
  assistantNav,
  preferenceViews,
  type View,
  workspaceViews,
} from "./nav";

type Item = (typeof workspaceViews)[number] | (typeof preferenceViews)[number];

function NavLinks({
  label,
  items,
  view,
  badges,
  go,
  children,
}: {
  label: string;
  items: readonly Item[];
  view: View;
  badges: Partial<Record<View, number>>;
  go: (view: View) => void;
  children?: ReactNode;
}) {
  return (
    <nav aria-label={label}>
      {items.map(({ view: destination, label: name, icon: Icon }) => {
        const count = badges[destination];
        return (
          <a
            key={destination}
            href={`#${destination}`}
            onClick={(event) => {
              event.preventDefault();
              go(destination);
            }}
            className={view === destination ? "active" : undefined}
            aria-current={view === destination ? "page" : undefined}
            title={name}
          >
            <Icon aria-hidden />
            <span>{name}</span>
            {count ? (
              <b className="nav-count" aria-label={`${count} triggered`}>
                {count}
              </b>
            ) : null}
          </a>
        );
      })}
      {children}
    </nav>
  );
}

function AssistantLink({
  active,
  toggle,
}: {
  active: boolean;
  toggle: () => void;
}) {
  const { label, icon: Icon } = assistantNav;
  return (
    <button
      type="button"
      className={active ? "nav-assistant active" : "nav-assistant"}
      aria-expanded={active}
      aria-controls="assistant-dock"
      aria-keyshortcuts="Meta+J Control+J"
      title={`${label} (⌘J)`}
      onClick={toggle}
    >
      <Icon aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function Sidebar({
  inert = false,
  view,
  open,
  badges,
  go,
  close,
  assistant,
}: {
  inert?: boolean;
  view: View;
  open: boolean;
  badges: Partial<Record<View, number>>;
  go: (view: View) => void;
  close: () => void;
  assistant: { active: boolean; toggle: () => void };
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);
  return (
    <>
      {open ? (
        <button
          type="button"
          className="mobile-scrim"
          onClick={close}
          aria-label="Close navigation"
        />
      ) : null}
      <aside
        className={`sidebar ${open ? "sidebar-open" : ""}`}
        inert={inert}
        aria-label="Sidebar"
      >
        <NavLinks
          label="Workspace"
          items={workspaceViews}
          view={view}
          badges={badges}
          go={go}
        >
          <AssistantLink active={assistant.active} toggle={assistant.toggle} />
        </NavLinks>
        <NavLinks
          label="Preferences"
          items={preferenceViews}
          view={view}
          badges={badges}
          go={go}
        />
      </aside>
    </>
  );
}
