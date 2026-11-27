"use client";

import {
  Check,
  ChevronRight,
  FolderInput,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import useSWR, { mutate } from "swr";
import { api } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, PromptDialog } from "@/components/ui/prompt-dialog";
import type { ThreadGroup, ThreadHit, ThreadSummary } from "@/lib/memory-types";
import { ago, useNow } from "./format";

export const threadsKey = "/api/threads";
export const groupsKey = "/api/thread-groups";
const searchPrefix = "/api/threads/search?q=";

export type ThreadPatch = {
  title?: string;
  groupId?: string | null;
  pinned?: boolean;
};

function write<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: object,
) {
  return api<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const threadUrl = (id: string) => `/api/threads/${encodeURIComponent(id)}`;
const groupUrl = (id: string) => `/api/thread-groups/${encodeURIComponent(id)}`;
const refreshSearch = () =>
  mutate(
    (key) => typeof key === "string" && key.startsWith(searchPrefix),
    undefined,
    { revalidate: true },
  );

export function useThreads() {
  return useSWR<ThreadSummary[]>(threadsKey, api, { revalidateOnMount: true });
}

export function useThreadGroups() {
  return useSWR<ThreadGroup[]>(groupsKey, api);
}

export async function patchThread(id: string, patch: ThreadPatch) {
  const apply = (current: ThreadSummary[] | undefined) =>
    (current ?? []).map((thread) =>
      thread.id === id ? { ...thread, ...patch } : thread,
    );
  await mutate<ThreadSummary[]>(
    threadsKey,
    async (current) => {
      await write<{ ok: true }>(threadUrl(id), "PATCH", patch);
      return apply(current);
    },
    { optimisticData: apply, rollbackOnError: true, revalidate: false },
  );
  void refreshSearch();
}

async function deleteThread(id: string) {
  await write<{ ok: true }>(threadUrl(id), "DELETE");
  await mutate<ThreadSummary[]>(
    threadsKey,
    (current) => current?.filter((thread) => thread.id !== id),
    { revalidate: false },
  );
  void refreshSearch();
}

async function createGroup(name: string) {
  const group = await write<ThreadGroup>(groupsKey, "POST", { name });
  await mutate<ThreadGroup[]>(
    groupsKey,
    (current) => [...(current ?? []), group],
    { revalidate: false },
  );
  return group;
}

async function renameGroup(id: string, name: string) {
  const apply = (current: ThreadGroup[] | undefined) =>
    (current ?? []).map((group) =>
      group.id === id ? { ...group, name } : group,
    );
  await mutate<ThreadGroup[]>(
    groupsKey,
    async (current) => {
      await write<{ ok: true }>(groupUrl(id), "PATCH", { name });
      return apply(current);
    },
    { optimisticData: apply, rollbackOnError: true, revalidate: false },
  );
}

async function deleteGroup(id: string) {
  await write<{ ok: true }>(groupUrl(id), "DELETE");
  await mutate<ThreadGroup[]>(
    groupsKey,
    (current) => current?.filter((group) => group.id !== id),
    { revalidate: false },
  );
  await mutate<ThreadSummary[]>(
    threadsKey,
    (current) =>
      current?.map((thread) =>
        thread.groupId === id ? { ...thread, groupId: null } : thread,
      ),
    { revalidate: true },
  );
}

const failureText = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message ? reason.message : fallback;

type Bucket = { label: string; threads: ThreadSummary[] };

function bucketByDay(threads: ThreadSummary[], now: number): Bucket[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const yesterday = today - 86_400_000;
  const week = today - 7 * 86_400_000;
  const buckets: Bucket[] = [
    { label: "Today", threads: [] },
    { label: "Yesterday", threads: [] },
    { label: "Previous 7 days", threads: [] },
    { label: "Older", threads: [] },
  ];
  for (const thread of threads) {
    const time = Date.parse(thread.updatedAt);
    const index =
      time >= today ? 0 : time >= yesterday ? 1 : time >= week ? 2 : 3;
    buckets[index]?.threads.push(thread);
  }
  return buckets.filter((bucket) => bucket.threads.length);
}

export function Highlight({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at}>{text.slice(at, at + needle.length)}</mark>);
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

export function InlineName({
  initial,
  label,
  maxLength,
  className,
  onDone,
}: {
  initial: string;
  label: string;
  maxLength: number;
  className?: string;
  /** `name` is null when cancelled or unchanged; `keyboard` when Enter or Esc ended it. */
  onDone: (name: string | null, keyboard: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const field = useRef<HTMLInputElement>(null);

  // A closing menu restores focus after this mounts, so autoFocus alone loses the race.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  function finish(save: boolean, keyboard: boolean) {
    if (finished.current) return;
    finished.current = true;
    const name = value.trim();
    onDone(save && name && name !== initial ? name : null, keyboard);
  }

  return (
    <input
      ref={field}
      className={["chat-rename", className].filter(Boolean).join(" ")}
      aria-label={label}
      value={value}
      maxLength={maxLength}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true, true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          finish(false, true);
        }
      }}
      onBlur={() => finish(true, false)}
    />
  );
}

type LibraryProps = {
  activeId: string;
  onOpen: (id: string) => Promise<void>;
  onNew?: () => void;
  onDeleted: (id: string) => void;
  autoFocusSearch?: boolean;
};

type Confirm =
  | { kind: "thread"; thread: ThreadSummary }
  | { kind: "group"; group: ThreadGroup; count: number };

export function ThreadLibrary({
  activeId,
  onOpen,
  onNew,
  onDeleted,
  autoFocusSearch = false,
}: LibraryProps) {
  const now = useNow();
  const threads = useThreads();
  const groups = useThreadGroups();
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [naming, setNaming] = useState<{ moveThread?: string } | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const next = query.trim();
    const timer = setTimeout(() => setTerm(next), next ? 220 : 0);
    return () => clearTimeout(timer);
  }, [query]);

  async function open(id: string) {
    setOpening(id);
    setFailure("");
    try {
      await onOpen(id);
    } catch (reason) {
      setFailure(failureText(reason, "Could not open the conversation."));
    } finally {
      setOpening(null);
    }
  }

  function run(action: Promise<unknown>, fallback: string) {
    setFailure("");
    action.catch((reason: unknown) =>
      setFailure(failureText(reason, fallback)),
    );
  }

  const actions: RowActions = {
    open: (id) => void open(id),
    rename: (id, title) =>
      run(patchThread(id, { title }), "Could not rename the conversation."),
    pin: (id, pinned) =>
      run(patchThread(id, { pinned }), "Could not update the conversation."),
    move: (id, groupId) =>
      run(patchThread(id, { groupId }), "Could not move the conversation."),
    newGroup: (moveThread) => setNaming({ moveThread }),
    remove: (thread) => setConfirm({ kind: "thread", thread }),
  };

  const groupList = groups.data ?? [];
  const all = threads.data ?? [];
  const pinned = all.filter((thread) => thread.pinned);
  const known = new Set(groupList.map((group) => group.id));
  const loose = all.filter(
    (thread) =>
      !thread.pinned && (thread.groupId === null || !known.has(thread.groupId)),
  );
  const buckets = bucketByDay(loose, now);
  const error = threads.error ?? groups.error;

  const rowProps = (thread: ThreadSummary) => ({
    thread,
    active: thread.id === activeId,
    opening: opening === thread.id,
    groups: groupList,
    actions,
  });

  return (
    <nav className="chat-library" aria-label="Conversations">
      <div className="chat-library-top">
        {onNew ? (
          <Button
            variant="ghost"
            size="sm"
            className="chat-library-new"
            onClick={onNew}
          >
            <SquarePen /> New chat
          </Button>
        ) : null}
        <SearchBox
          query={query}
          term={term}
          autoFocus={autoFocusSearch}
          activeId={activeId}
          onQuery={setQuery}
          onOpen={(id) => void open(id)}
        />
      </div>

      {failure || error ? (
        <p className="chat-tool-error chat-library-error" role="alert">
          {failure || failureText(error, "Could not load conversations.")}
        </p>
      ) : null}

      {query.trim() ? null : (
        <div className="chat-library-scroll">
          {threads.isLoading && !threads.data ? (
            <div className="chat-library-loading" role="status">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="sr-only">Loading conversations</span>
            </div>
          ) : null}

          {pinned.length ? (
            <LibrarySection label="Pinned">
              <ul className="chat-lib-list">
                {pinned.map((thread) => (
                  <ThreadRow key={thread.id} {...rowProps(thread)} />
                ))}
              </ul>
            </LibrarySection>
          ) : null}

          <LibrarySection
            label="Groups"
            action={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="New group"
                title="New group"
                onClick={() => setNaming({})}
              >
                <Plus />
              </Button>
            }
          >
            {groupList.length ? (
              <ul className="chat-lib-groups">
                {groupList.map((group) => {
                  const members = all.filter(
                    (thread) => thread.groupId === group.id && !thread.pinned,
                  );
                  const open = !collapsed.has(group.id);
                  return (
                    <GroupBlock
                      key={group.id}
                      group={group}
                      count={members.length}
                      open={open}
                      onToggle={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (open) next.add(group.id);
                          else next.delete(group.id);
                          return next;
                        })
                      }
                      onRename={(name) =>
                        run(
                          renameGroup(group.id, name),
                          "Could not rename the group.",
                        )
                      }
                      onDelete={() =>
                        setConfirm({
                          kind: "group",
                          group,
                          count: all.filter(
                            (thread) => thread.groupId === group.id,
                          ).length,
                        })
                      }
                    >
                      {members.length ? (
                        <ul className="chat-lib-list">
                          {members.map((thread) => (
                            <ThreadRow key={thread.id} {...rowProps(thread)} />
                          ))}
                        </ul>
                      ) : (
                        <p className="chat-lib-quiet">No conversations</p>
                      )}
                    </GroupBlock>
                  );
                })}
              </ul>
            ) : (
              <p className="chat-lib-quiet">
                Group conversations by company, theme or portfolio.
              </p>
            )}
          </LibrarySection>

          {buckets.map((bucket) => (
            <LibrarySection key={bucket.label} label={bucket.label}>
              <ul className="chat-lib-list">
                {bucket.threads.map((thread) => (
                  <ThreadRow key={thread.id} {...rowProps(thread)} />
                ))}
              </ul>
            </LibrarySection>
          ))}

          {threads.data && !threads.data.length ? (
            <p className="chat-lib-quiet chat-lib-empty">
              No conversations yet. Each one is saved after its first answer.
            </p>
          ) : null}
        </div>
      )}

      {confirm?.kind === "thread" ? (
        <ConfirmDialog
          title={`Delete “${confirm.thread.title}”?`}
          description="The conversation and its answers are removed for good."
          confirmLabel="Delete"
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const { id } = confirm.thread;
            run(
              deleteThread(id).then(() => onDeleted(id)),
              "Could not delete the conversation.",
            );
          }}
        />
      ) : confirm?.kind === "group" ? (
        <ConfirmDialog
          title={`Delete the group “${confirm.group.name}”?`}
          description={
            confirm.count
              ? `Its ${confirm.count === 1 ? "conversation moves" : `${confirm.count} conversations move`} back to Ungrouped. Nothing is deleted.`
              : "The group is empty. No conversations are affected."
          }
          confirmLabel="Delete group"
          destructive
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            run(deleteGroup(confirm.group.id), "Could not delete the group.")
          }
        />
      ) : null}

      {naming ? (
        <PromptDialog
          title={naming.moveThread ? "Move to a new group" : "New group"}
          label="Group name"
          placeholder="e.g. Semiconductors"
          maxLength={60}
          confirmLabel={naming.moveThread ? "Create and move" : "Create"}
          onClose={() => setNaming(null)}
          onSubmit={(name) => {
            const target = naming.moveThread;
            run(
              createGroup(name).then((group) =>
                target ? patchThread(target, { groupId: group.id }) : undefined,
              ),
              "Could not create the group.",
            );
          }}
        />
      ) : null}
    </nav>
  );
}

function LibrarySection({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="chat-lib-section" aria-labelledby={id}>
      <div className="chat-lib-section-head">
        <h3 id={id} className="kicker">
          {label}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function SearchBox({
  query,
  term,
  autoFocus,
  activeId,
  onQuery,
  onOpen,
}: {
  query: string;
  term: string;
  autoFocus: boolean;
  activeId: string;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const { data, error, isLoading } = useSWR<ThreadHit[]>(
    term ? `${searchPrefix}${encodeURIComponent(term)}` : null,
    api,
    { keepPreviousData: true },
  );
  const [cursor, setCursor] = useState({ term: "", index: 0 });
  const searching = Boolean(query.trim());
  const hits = searching ? (data ?? []) : [];
  const index =
    cursor.term === term ? Math.min(cursor.index, hits.length - 1) : 0;
  const optionId = (at: number) => `${listId}-${at}`;
  const pending = searching && (query.trim() !== term || isLoading);

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      onQuery("");
      return;
    }
    if (!hits.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = (Math.max(index, 0) + delta + hits.length) % hits.length;
      setCursor({ term, index: next });
      document
        .getElementById(optionId(next))
        ?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      const hit = hits[Math.max(index, 0)];
      if (!hit) return;
      event.preventDefault();
      onOpen(hit.id);
    }
  }

  return (
    <>
      <div className="chat-search">
        <Search aria-hidden />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search conversations"
          aria-expanded={searching}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            hits.length && index >= 0 ? optionId(index) : undefined
          }
          placeholder="Search conversations"
          value={query}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={key}
        />
        {query ? (
          <button
            type="button"
            className="chat-search-clear"
            aria-label="Clear search"
            onClick={() => {
              onQuery("");
              input.current?.focus();
            }}
          >
            <X aria-hidden />
          </button>
        ) : null}
      </div>
      {searching ? (
        <div className="chat-library-scroll chat-search-results">
          <p className="chat-lib-quiet" role="status">
            {pending
              ? "Searching…"
              : error
                ? failureText(error, "Search failed.")
                : hits.length
                  ? `${hits.length}${hits.length === 30 ? "+" : ""} ${hits.length === 1 ? "match" : "matches"}`
                  : `Nothing matches “${term}”.`}
          </p>
          <ul
            id={listId}
            role="listbox"
            aria-label="Matching conversations"
            className="chat-hits"
          >
            {hits.map((hit, at) => (
              <li
                key={hit.id}
                id={optionId(at)}
                role="option"
                aria-selected={at === index}
                data-active={hit.id === activeId || undefined}
                className="chat-hit"
                onMouseMove={() => {
                  if (at !== index) setCursor({ term, index: at });
                }}
                onClick={() => onOpen(hit.id)}
              >
                <span className="chat-hit-title">
                  <Highlight text={hit.title} term={term} />
                </span>
                {hit.snippet ? (
                  <span className="chat-hit-snippet">
                    <Highlight text={hit.snippet} term={term} />
                  </span>
                ) : null}
                <HitMeta updatedAt={hit.updatedAt} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function HitMeta({ updatedAt }: { updatedAt: string }) {
  const now = useNow();
  return <span className="chat-hit-meta">{ago(updatedAt, now)}</span>;
}

type RowActions = {
  open: (id: string) => void;
  rename: (id: string, title: string) => void;
  pin: (id: string, pinned: boolean) => void;
  move: (id: string, groupId: string | null) => void;
  newGroup: (id: string) => void;
  remove: (thread: ThreadSummary) => void;
};

function ThreadRow({
  thread,
  active,
  opening,
  groups,
  actions,
}: {
  thread: ThreadSummary;
  active: boolean;
  opening: boolean;
  groups: ThreadGroup[];
  actions: RowActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const skipRestore = useRef(false);
  const openButton = useRef<HTMLButtonElement>(null);

  return (
    <li
      className="chat-lib-row"
      data-active={active || undefined}
      data-menu={menu || undefined}
    >
      {renaming ? (
        <InlineName
          initial={thread.title}
          label="Conversation name"
          maxLength={200}
          onDone={(title, keyboard) => {
            setRenaming(false);
            if (title) actions.rename(thread.id, title);
            if (keyboard)
              requestAnimationFrame(() => openButton.current?.focus());
          }}
        />
      ) : (
        <button
          ref={openButton}
          type="button"
          className="chat-lib-open"
          aria-current={active ? "true" : undefined}
          aria-busy={opening || undefined}
          title={thread.title}
          onClick={() => actions.open(thread.id)}
          onDoubleClick={() => setRenaming(true)}
        >
          {thread.pinned ? <Pin aria-hidden className="chat-lib-pin" /> : null}
          <span className="chat-truncate">{thread.title}</span>
        </button>
      )}
      <DropdownMenu.Root open={menu} onOpenChange={setMenu}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="chat-lib-more"
            aria-label={`Options for “${thread.title}”`}
          >
            <MoreHorizontal aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="menu-content chat-lib-menu"
            align="start"
            side="bottom"
            sideOffset={4}
            onCloseAutoFocus={(event) => {
              if (!skipRestore.current) return;
              skipRestore.current = false;
              event.preventDefault();
            }}
          >
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() => {
                skipRestore.current = true;
                setRenaming(true);
              }}
            >
              <Pencil aria-hidden /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="menu-item"
              onSelect={() => actions.pin(thread.id, !thread.pinned)}
            >
              {thread.pinned ? (
                <>
                  <PinOff aria-hidden /> Unpin
                </>
              ) : (
                <>
                  <Pin aria-hidden /> Pin
                </>
              )}
            </DropdownMenu.Item>
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className="menu-item">
                <FolderInput aria-hidden /> Move to group
                <ChevronRight aria-hidden className="chat-lib-sub" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  className="menu-content chat-lib-menu"
                  sideOffset={4}
                >
                  <DropdownMenu.RadioGroup
                    value={thread.groupId ?? ""}
                    onValueChange={(value) =>
                      actions.move(thread.id, value || null)
                    }
                  >
                    <DropdownMenu.RadioItem value="" className="menu-item">
                      Ungrouped
                      <DropdownMenu.ItemIndicator className="menu-check">
                        <Check aria-hidden />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                    {groups.map((group) => (
                      <DropdownMenu.RadioItem
                        key={group.id}
                        value={group.id}
                        className="menu-item"
                      >
                        <span className="chat-truncate">{group.name}</span>
                        <DropdownMenu.ItemIndicator className="menu-check">
                          <Check aria-hidden />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                  <DropdownMenu.Separator className="menu-separator" />
                  <DropdownMenu.Item
                    className="menu-item"
                    onSelect={() => actions.newGroup(thread.id)}
                  >
                    <FolderPlus aria-hidden /> New group…
                  </DropdownMenu.Item>
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item
              className="menu-item menu-item-danger"
              onSelect={() => actions.remove(thread)}
            >
              <Trash2 aria-hidden /> Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </li>
  );
}

function GroupBlock({
  group,
  count,
  open,
  onToggle,
  onRename,
  onDelete,
  children,
}: {
  group: ThreadGroup;
  count: number;
  open: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState(false);
  const skipRestore = useRef(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const bodyId = useId();

  return (
    <li className="chat-lib-group" data-menu={menu || undefined}>
      <div className="chat-lib-row chat-lib-group-head">
        {renaming ? (
          <InlineName
            initial={group.name}
            label="Group name"
            maxLength={60}
            onDone={(name, keyboard) => {
              setRenaming(false);
              if (name) onRename(name);
              if (keyboard)
                requestAnimationFrame(() => toggle.current?.focus());
            }}
          />
        ) : (
          <button
            ref={toggle}
            type="button"
            className="chat-lib-open chat-lib-group-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            <ChevronRight aria-hidden className="chat-lib-chevron" />
            <span className="chat-truncate">{group.name}</span>
            <span className="chat-lib-count">{count}</span>
          </button>
        )}
        <DropdownMenu.Root open={menu} onOpenChange={setMenu}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="chat-lib-more"
              aria-label={`Options for the group “${group.name}”`}
            >
              <MoreHorizontal aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="menu-content chat-lib-menu"
              align="start"
              sideOffset={4}
              onCloseAutoFocus={(event) => {
                if (!skipRestore.current) return;
                skipRestore.current = false;
                event.preventDefault();
              }}
            >
              <DropdownMenu.Item
                className="menu-item"
                onSelect={() => {
                  skipRestore.current = true;
                  setRenaming(true);
                }}
              >
                <Pencil aria-hidden /> Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="menu-item menu-item-danger"
                onSelect={onDelete}
              >
                <Trash2 aria-hidden /> Delete group
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div id={bodyId} hidden={!open} className="chat-lib-group-body">
        {children}
      </div>
    </li>
  );
}
