"use client";

import { useEffect } from "react";
import { preferenceViews, type View, workspaceViews } from "./nav";

type Item = (typeof workspaceViews)[number] | (typeof preferenceViews)[number];

function NavLinks({
  label,
  items,
  view,
  badges,
  go,
}: {
  label: string;
  items: readonly Item[];
  view: View;
  badges: Partial<Record<View, number>>;
  go: (view: View) => void;
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
    </nav>
  );
}

export function Sidebar({
  view,
  open,
  badges,
  go,
  close,
}: {
  view: View;
  open: boolean;
  badges: Partial<Record<View, number>>;
  go: (view: View) => void;
  close: () => void;
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
        aria-label="Sidebar"
      >
        <NavLinks
          label="Workspace"
          items={workspaceViews}
          view={view}
          badges={badges}
          go={go}
        />
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
