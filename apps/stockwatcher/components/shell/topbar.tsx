"use client";

import {
  Brain,
  Command,
  LogOut,
  Menu,
  ScanSearch,
  Search,
  Settings2,
  UserRound,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef } from "react";
import { BrandGlyph } from "@/components/brand-glyph";
import { Button } from "@/components/ui/button";
import type { Command as TerminalCommand } from "@/lib/terminal";
import { CommandLine } from "./command-line";
import type { Account } from "./settings";

export function Topbar({
  inert = false,
  account,
  navOpen,
  onMenu,
  onHome,
  onSearch,
  onSettings,
  onMemory,
  security,
  onCommand,
}: {
  inert?: boolean;
  account: Account;
  security?: string;
  onCommand: (command: TerminalCommand) => void;
  navOpen: boolean;
  onMenu: () => void;
  onHome: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onMemory: () => void;
}) {
  const logout = useRef<HTMLFormElement>(null);
  return (
    <header className="topbar" inert={inert}>
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
            <BrandGlyph size={15} />
          </span>
          <span className="brand-name">Stockwatcher</span>
        </a>
      </div>
      <div className="topbar-command">
        <CommandLine current={security} onCommand={onCommand} />
        <Button
          variant="outline"
          size="sm"
          className="global-search"
          aria-label="Search symbols"
          onClick={onSearch}
        >
          <Search />
          <span className="sr-only">Search</span>
          <kbd>
            <Command size={10} />K
          </kbd>
        </Button>
      </div>
      <div className="topbar-actions">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="avatar"
              aria-label={`Account: ${account.name}`}
            >
              {account.picture ? (
                <img src={account.picture} alt="" width={26} height={26} />
              ) : (
                account.name.trim().slice(0, 1).toUpperCase()
              )}
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
              {account.demo ? null : (
                <DropdownMenu.Item className="menu-item" asChild>
                  <a href="/account">
                    <UserRound /> Account
                  </a>
                </DropdownMenu.Item>
              )}
              {account.admin ? (
                <DropdownMenu.Item className="menu-item" asChild>
                  <a href="/admin">
                    <ScanSearch /> Assistant audit
                  </a>
                </DropdownMenu.Item>
              ) : null}
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
