"use client";

import { Pencil, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import useSWR from "swr";
import { api } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type Memory,
  type MemoryInput,
  type MemoryKind,
  memoryKinds,
} from "@/lib/memory-types";
import { symbolPattern } from "@/lib/universes";
import { ago, useNow } from "./format";

export const memoriesKey = "/api/memories";

const kindLabels: Record<MemoryKind, { group: string; one: string }> = {
  position: { group: "Positions", one: "Position" },
  thesis: { group: "Theses", one: "Thesis" },
  watch: { group: "Watching", one: "Watch" },
  preference: { group: "Preferences", one: "Preference" },
  fact: { group: "Facts", one: "Fact" },
};

const groupOrder: MemoryKind[] = [
  "position",
  "thesis",
  "watch",
  "preference",
  "fact",
];

function isKind(value: string): value is MemoryKind {
  return memoryKinds.some((kind) => kind === value);
}

function parseSymbols(text: string) {
  const symbols = [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const invalid = symbols.filter((symbol) => !symbolPattern.test(symbol));
  return { symbols: symbols.slice(0, 12), invalid };
}

const jsonInit = (method: string, body: MemoryInput): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function MemoryPanel({
  className,
  onClose,
}: {
  className?: string;
  onClose?: () => void;
}) {
  const now = useNow();
  const { data, error, isLoading, mutate } = useSWR<Memory[]>(memoriesKey, api);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState("");

  const groups = groupOrder
    .map((kind) => ({
      kind,
      items: (data ?? []).filter((memory) => memory.kind === kind),
    }))
    .filter((group) => group.items.length);

  async function create(input: MemoryInput) {
    const memory = await api<Memory>(memoriesKey, jsonInit("POST", input));
    await mutate(
      (current) => [
        memory,
        ...(current ?? []).filter((item) => item.id !== memory.id),
      ],
      { revalidate: false },
    );
    setAdding(false);
  }

  async function save(id: string, input: MemoryInput) {
    const memory = await api<Memory>(
      `${memoriesKey}/${id}`,
      jsonInit("PATCH", input),
    );
    await mutate(
      (current) =>
        (current ?? []).map((item) => (item.id === id ? memory : item)),
      { revalidate: false },
    );
    setEditing(null);
  }

  async function remove(id: string) {
    setFailure("");
    const previous = data;
    await mutate(
      (current) => (current ?? []).filter((item) => item.id !== id),
      { revalidate: false },
    );
    try {
      await api<{ ok: true }>(`${memoriesKey}/${id}`, { method: "DELETE" });
    } catch (reason) {
      await mutate(previous, { revalidate: false });
      setFailure(
        reason instanceof Error ? reason.message : "Could not delete memory.",
      );
    }
  }

  return (
    <section
      className={["section memory-panel", className].filter(Boolean).join(" ")}
      aria-label="Assistant memory"
    >
      <header className="section-head">
        <div>
          <h2>Memory</h2>
          <p>
            What the assistant knows about you between conversations
            {data ? ` · ${data.length}` : ""}
          </p>
        </div>
        <div className="row-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAdding((open) => !open);
              setEditing(null);
            }}
            aria-expanded={adding}
          >
            <Plus /> Add
          </Button>
          {onClose ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close memory"
              onClick={onClose}
            >
              <X />
            </Button>
          ) : null}
        </div>
      </header>
      <div className="section-body">
        {adding ? (
          <MemoryForm
            submitLabel="Save memory"
            onSubmit={create}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {failure || error ? (
          <p className="chat-tool-error" role="alert">
            {failure || (error instanceof Error ? error.message : "")}
          </p>
        ) : null}
        {isLoading && !data ? (
          <p className="chat-quiet">Loading memory…</p>
        ) : !groups.length ? (
          <div className="empty">
            <strong>Nothing remembered yet</strong>
            <div>
              The assistant saves durable facts as you talk: positions held
              outside the ledger, theses, what you are watching and how you like
              answers. Add one yourself to steer it.
            </div>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.kind} className="memory-group">
              <div className="memory-group-head">
                <span className="kicker">{kindLabels[group.kind].group}</span>
                <span className="meta">{group.items.length}</span>
              </div>
              <ul className="ruled-list flush-top">
                {group.items.map((memory) =>
                  editing === memory.id ? (
                    <li key={memory.id}>
                      <MemoryForm
                        initial={memory}
                        submitLabel="Save"
                        onSubmit={(input) => save(memory.id, input)}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  ) : (
                    <li key={memory.id} className="memory-item">
                      <div className="memory-body">
                        <p>{memory.content}</p>
                        <span className="meta">
                          {memory.symbols.length ? (
                            <span className="memory-symbols">
                              {memory.symbols.map((symbol) => (
                                <span key={symbol} className="tag">
                                  {symbol}
                                </span>
                              ))}
                            </span>
                          ) : null}
                          {ago(memory.updatedAt, now)}
                        </span>
                      </div>
                      <div className="memory-actions">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Edit memory"
                          onClick={() => {
                            setEditing(memory.id);
                            setAdding(false);
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Delete memory"
                          onClick={() => void remove(memory.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  ),
                )}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MemoryForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Memory;
  submitLabel: string;
  onSubmit: (input: MemoryInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<MemoryKind>(initial?.kind ?? "thesis");
  const [content, setContent] = useState(initial?.content ?? "");
  const [symbols, setSymbols] = useState(initial?.symbols.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = content.trim();
    if (!text) return;
    const parsed = parseSymbols(symbols);
    if (parsed.invalid.length) {
      setFailure(`Not a valid symbol: ${parsed.invalid.join(", ")}`);
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      await onSubmit({ kind, content: text, symbols: parsed.symbols });
    } catch (reason) {
      setFailure(
        reason instanceof Error ? reason.message : "Could not save memory.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="memory-form" onSubmit={submit}>
      <textarea
        className="chat-input memory-input"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="e.g. Long ASML as an EUV monopoly; trim above 30x forward earnings"
        aria-label="Memory"
        maxLength={1000}
        rows={2}
        autoFocus
      />
      <div className="memory-form-row">
        <Select
          value={kind}
          onValueChange={(value) => {
            if (isKind(value)) setKind(value);
          }}
        >
          <SelectTrigger size="sm" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {groupOrder.map((option) => (
              <SelectItem key={option} value={option}>
                {kindLabels[option].one}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          className="memory-symbols-input"
          value={symbols}
          onChange={(event) => setSymbols(event.target.value)}
          placeholder="Symbols, e.g. ASML.AS NVDA"
          aria-label="Symbols"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <div className="memory-form-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !content.trim()}>
            {saving ? "Saving…" : submitLabel}
          </Button>
        </div>
      </div>
      {failure ? (
        <p className="negative memory-error" role="alert">
          {failure}
        </p>
      ) : null}
    </form>
  );
}
