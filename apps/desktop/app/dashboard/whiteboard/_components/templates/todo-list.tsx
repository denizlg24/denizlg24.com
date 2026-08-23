"use client";

import { Checkbox } from "@repo/ui/checkbox";
import {
  TODO_ACTION_ROW_HEIGHT,
  TODO_HEADER_HEIGHT,
  TODO_ROW_HEIGHT,
  TODO_TEXT_SIZE,
  todoListHeight,
  WHITEBOARD_FONT_FAMILIES,
} from "@repo/whiteboard-render";
import { Plus, Trash2, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TemplateProps } from ".";

interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}

const HAND = WHITEBOARD_FONT_FAMILIES.handwriting.css;

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const TodoListTemplate = ({
  width,
  height,
  data,
  onDataChange,
}: TemplateProps) => {
  const title = typeof data.title === "string" ? data.title : "";
  const items = Array.isArray(data.items) ? (data.items as TodoItem[]) : [];

  const [hovered, setHovered] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const done = items.filter((i) => i.completed).length;
  /* The header is in the flow, so it may only appear when there is a title to
     show. Revealing it on hover would push every row down and overflow a box
     sized to its rows. Adding a title is offered from the action row instead,
     whose height is already reserved. */
  const showHeader = title.length > 0 || editingTitle;

  /* A checklist's height is entirely determined by its rows, so every write
     reports the height the content now needs. Adding a row grows the box
     instead of pushing the list into an overflow scroll, and dropping one
     gives the space back. */
  const write = (
    next: Record<string, unknown>,
    itemCount: number,
    titled: boolean,
  ) => onDataChange(next, { height: todoListHeight(itemCount, titled) });

  const writeItems = (next: TodoItem[]) =>
    write({ ...data, items: next }, next.length, showHeader);

  /** Commits the open row. An empty row is dropped rather than left stranded,
   *  which is what makes "add row, then click away" a no-op instead of debris. */
  const commitEditing = (append: boolean) => {
    const id = editingId;
    if (!id) return;
    const text = draft.trim();
    setEditingId(null);
    setDraft("");
    if (!text) {
      writeItems(items.filter((i) => i.id !== id));
      return;
    }
    const next = items.map((i) => (i.id === id ? { ...i, text } : i));
    if (!append) {
      writeItems(next);
      return;
    }
    const added: TodoItem = { id: makeId(), text: "", completed: false };
    writeItems([...next, added]);
    setEditingId(added.id);
  };

  const addRow = () => {
    const added: TodoItem = { id: makeId(), text: "", completed: false };
    writeItems([...items, added]);
    setDraft("");
    setEditingId(added.id);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next !== title) {
      write({ ...data, title: next }, items.length, next.length > 0);
    }
  };

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ width, height, fontFamily: HAND }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {showHeader && (
        <div
          className="flex shrink-0 items-baseline justify-between gap-3"
          style={{ height: TODO_HEADER_HEIGHT }}
        >
          {editingTitle ? (
            <input
              // biome-ignore lint/a11y/noAutofocus: focus follows the click that opened the field
              autoFocus
              className="min-w-0 grow bg-transparent text-[17px] outline-none"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") {
                  setTitleDraft(title);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="min-w-0 grow truncate text-left text-[17px] text-muted-foreground"
              onClick={() => {
                setTitleDraft(title);
                setEditingTitle(true);
              }}
            >
              {title}
            </button>
          )}
          {items.length > 0 && (
            <span className="shrink-0 text-[15px] tabular-nums text-muted-foreground">
              {done}/{items.length}
            </span>
          )}
        </div>
      )}

      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className="group/row flex shrink-0 items-center gap-4"
            style={{ height: TODO_ROW_HEIGHT }}
          >
            <Checkbox
              className="size-6 shrink-0 rounded-none border-2 border-foreground data-[state=checked]:border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background [&_svg]:size-5"
              checked={item.completed}
              onCheckedChange={(checked) =>
                writeItems(
                  items.map((i) =>
                    i.id === item.id
                      ? { ...i, completed: checked === true }
                      : i,
                  ),
                )
              }
            />
            {editingId === item.id ? (
              <input
                ref={inputRef}
                className="min-w-0 grow bg-transparent leading-tight outline-none"
                style={{ fontSize: TODO_TEXT_SIZE }}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitEditing(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitEditing(true);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commitEditing(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className={`min-w-0 grow truncate text-left leading-tight ${
                  item.completed
                    ? "text-muted-foreground line-through"
                    : "text-foreground"
                }`}
                style={{ fontSize: TODO_TEXT_SIZE }}
                onClick={() => {
                  setDraft(item.text);
                  setEditingId(item.id);
                }}
              >
                {item.text}
              </button>
            )}
            <button
              type="button"
              aria-label="Delete row"
              className="hidden size-6 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive group-hover/row:flex"
              onClick={() => writeItems(items.filter((i) => i.id !== item.id))}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>

      <div
        className={`flex shrink-0 items-center justify-between transition-opacity ${
          hovered ? "opacity-100" : "opacity-0"
        }`}
        style={{ height: TODO_ACTION_ROW_HEIGHT }}
      >
        <button
          type="button"
          aria-label="Add row"
          className="flex size-6 shrink-0 items-center justify-center border-2 border-dashed border-muted-foreground/60 text-muted-foreground/60 hover:border-foreground hover:text-foreground"
          onClick={addRow}
        >
          <Plus className="size-4" />
        </button>
        {!showHeader && (
          <button
            type="button"
            aria-label="Add title"
            className="flex size-6 shrink-0 items-center justify-center text-muted-foreground/60 hover:text-foreground"
            onClick={() => {
              setTitleDraft("");
              setEditingTitle(true);
            }}
          >
            <Type className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
};
