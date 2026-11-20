"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSearch } from "@/components/market-widgets";
import {
  monitorFunctions,
  parseCommand,
  securityFunctions,
  suggestFunctions,
  workspaceFunctions,
  type Command,
} from "@/lib/terminal";

type Suggestion = { value: string; code: string; label: string; detail: string };

export function CommandLine({
  current,
  onCommand,
}: {
  current?: string;
  onCommand: (command: Command) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 220);
    return () => clearTimeout(timer);
  }, [text]);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const searching = words.length === 1 && debounced.length >= 2;
  const { data } = useSearch(debounced, searching);

  useEffect(() => {
    function focus(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/" || event.key === "F8") {
        event.preventDefault();
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);

  const functionHints: Suggestion[] = suggestFunctions(text).map((item) => {
    const prefix = words.length > 1 ? `${words.slice(0, -1).join(" ")} ` : "";
    const ticker =
      item.scope === "security" && !prefix && current ? `${current} ` : prefix;
    return {
      value: `${ticker}${item.code}`,
      code: item.code,
      label: item.label,
      detail:
        item.scope === "security"
          ? `${ticker.trim() || "Security"} · ${item.detail}`
          : item.detail,
    };
  });
  const symbolHints: Suggestion[] = searching
    ? (data?.instruments ?? []).slice(0, 6).map((item) => ({
        value: `${item.symbol} GP`,
        code: item.symbol,
        label: item.name,
        detail: [item.exchange, item.type].filter(Boolean).join(" · "),
      }))
    : [];
  const suggestions = [...functionHints, ...symbolHints].slice(0, 9);

  function run(value: string) {
    const command = parseCommand(value, current);
    if (!command) return;
    onCommand(command);
    setText("");
    setOpen(false);
    input.current?.blur();
  }

  return (
    <form
      className="command-line"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const chosen = open && active >= 0 ? suggestions[active] : undefined;
        run(chosen ? chosen.value : text);
      }}
    >
      <label htmlFor="command-input" className="sr-only">
        Command: ticker and function, for example AAPL DES
      </label>
      <span className="command-prompt" aria-hidden>
        {current ? `${current} >` : ">"}
      </span>
      <input
        id="command-input"
        ref={input}
        autoComplete="off"
        spellCheck={false}
        placeholder="AAPL DES · MOST · HELP"
        value={text}
        maxLength={80}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls="command-suggestions"
        aria-activedescendant={
          open && suggestions[active] ? `command-${active}` : undefined
        }
        onChange={(event) => {
          setText(event.target.value.toUpperCase());
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(suggestions.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(-1, index - 1));
          } else if (event.key === "Escape") {
            setText("");
            setOpen(false);
            input.current?.blur();
          } else if (event.key === "Tab" && open && suggestions.length) {
            event.preventDefault();
            setText(`${suggestions[Math.max(0, active)].value} `);
          }
        }}
      />
      <button type="submit" className="command-go" title="Run (Enter)">
        GO
      </button>
      {open && text.trim() && suggestions.length ? (
        <ul id="command-suggestions" className="command-suggestions" role="listbox">
          {suggestions.map((item, index) => (
            <li
              key={`${item.value}-${index}`}
              id={`command-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => {
                event.preventDefault();
                run(item.value);
              }}
              onMouseEnter={() => setActive(index)}
            >
              <b>{item.code}</b>
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function CommandHelp({ close }: { close: () => void }) {
  const sections = [
    {
      title: "Security functions · TICKER FN <GO>",
      items: securityFunctions.map(({ code, label, detail }) => ({
        code,
        label,
        detail,
      })),
    },
    {
      title: "Monitors",
      items: monitorFunctions.map(({ code, label, detail }) => ({
        code,
        label,
        detail,
      })),
    },
    {
      title: "Workspace",
      items: workspaceFunctions.map(({ code, label, detail }) => ({
        code,
        label,
        detail,
      })),
    },
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="command-help">
        <DialogHeader>
          <DialogTitle>Function directory</DialogTitle>
          <DialogDescription>
            Type a ticker, then a function, and press Enter: <kbd>NVDA ANR</kbd>
            . A function on its own applies to the security on screen. Press{" "}
            <kbd>/</kbd> anywhere to focus the command line. Bloomberg-style
            yellow keys such as <kbd>US EQUITY</kbd> and <kbd>&lt;GO&gt;</kbd>{" "}
            are accepted and ignored.
          </DialogDescription>
        </DialogHeader>
        {sections.map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <dl>
              {section.items.map((item) => (
                <div key={item.code}>
                  <dt>{item.code}</dt>
                  <dd>
                    <strong>{item.label}</strong> {item.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
