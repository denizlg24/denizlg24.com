"use client";

import { useRef } from "react";
import { DropdownMenu } from "radix-ui";
import {
  ChartNoAxesCombined,
  Command,
  LogOut,
  Menu,
  PanelRight,
  Search,
  Settings2,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Benchmarks } from "@/components/market-widgets";
import { MarketClock } from "./market-clock";
import type { Account } from "./settings";

export function Topbar({
  account,
  ticker,
  refresh,
  navOpen,
  assistantOpen,
  onMenu,
  onHome,
  onSearch,
  onAssistant,
  onSymbol,
  onSettings,
  onMemory,
}: {
  account: Account;
  ticker?: string;
  refresh: boolean;
  navOpen: boolean;
  assistantOpen: boolean;
  onMenu: () => void;
  onHome: () => void;
  onSearch: () => void;
  onAssistant: () => void;
  onSymbol: (symbol: string) => void;
  onSettings: () => void;
  onMemory: () => void;
}) {
  const logout = useRef<HTMLFormElement>(null);
  return (
    <header className="topbar">
      <div className="topbar-lead">
        <Button
          variant="ghost"
          size="icon-sm"
          className="menu-button"
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={onMenu}
        >
          <Menu />
        </Button>
        <a
          href="#desk"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            onHome();
          }}
        >
          <span className="brand-mark">
            <ChartNoAxesCombined size={15} />
          </span>
          <span className="brand-name">Stockwatcher</span>
        </a>
      </div>
      <div className="topbar-tape">
        <Benchmarks
          selected={ticker ?? ""}
          select={onSymbol}
          refresh={refresh}
        />
      </div>
      <div className="topbar-actions">
        <Button
          variant="outline"
          size="sm"
          className="global-search"
          aria-label="Search symbols"
          onClick={onSearch}
        >
          <Search />
          <span>Search</span>
          <kbd>
            <Command size={10} />K
          </kbd>
        </Button>
        <MarketClock />
        <Button
          variant={assistantOpen ? "secondary" : "ghost"}
          size="sm"
          className="ask-button"
          aria-expanded={assistantOpen}
          aria-controls="assistant-dock"
          title="Assistant (⌘J)"
          onClick={onAssistant}
        >
          <PanelRight />
          <span>Ask Stockwatcher</span>
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="avatar"
              aria-label={`Account: ${account.name}`}
            >
              {account.name.trim().slice(0, 1).toUpperCase()}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="menu-content"
              align="end"
              sideOffset={6}
            >
              <DropdownMenu.Label className="menu-label">
                <strong>{account.name}</strong>
                <small>
                  {account.demo
                    ? "Preview workspace"
                    : (account.email ?? "Deniz Cloud account")}
                </small>
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" onSelect={onSettings}>
                <Settings2 /> Settings
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={onMemory}>
                <Brain /> Memory
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => logout.current?.requestSubmit()}
              >
                <LogOut /> Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <form ref={logout} action="/auth/logout" method="post" hidden />
      </div>
    </header>
  );
}
