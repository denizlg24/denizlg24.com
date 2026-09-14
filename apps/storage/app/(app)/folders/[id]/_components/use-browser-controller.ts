"use client";

import { pluralize } from "@repo/cloud-ui/format";
import type { StorageFile } from "@repo/schemas/cloud";
import { useRouter } from "next/navigation";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { Density } from "@/components/tile";
import { api, errorMessage } from "@/lib/api";
import { downloadArchive, triggerDownload } from "@/lib/download";
import {
  activeDrag,
  beginDrag,
  endDrag,
  isFileDrag,
  readDrop,
} from "@/lib/drag";
import {
  type DeletableEntry,
  type FolderView,
  storage,
  UNDO_WINDOW_MS,
  useFolder,
} from "@/lib/queries";
import { readDataTransfer, readFileList, uploads } from "@/lib/uploads";
import { usePreference } from "@/lib/use-preference";
import { useWindowedRows } from "@/lib/use-windowed-rows";
import { ArchiveToastCard } from "./archive-progress";
import {
  type BrowserRow,
  SORT_DIRECTIONS,
  SORT_KEYS,
  type SortDirection,
  type SortKey,
  sortRows,
  toRows,
} from "./rows";

export const VIEWS = ["grid", "list"] as const;
export type View = (typeof VIEWS)[number];
export const DENSITIES = ["comfortable", "compact"] as const;
const FOLDERS_FIRST = ["yes", "no"] as const;

/**
 * Rows are draggable, and a drag the browser starts between two fast clicks
 * suppresses the native `dblclick` entirely — the item just ends up selected.
 * Counting the clicks ourselves keeps opening independent of that. Matches the
 * Windows double-click default.
 */
const DOUBLE_CLICK_MS = 500;
/** A touch held this long on a tile enters selection mode. */
const LONG_PRESS_MS = 450;

export function toEntries(rows: BrowserRow[]): DeletableEntry[] {
  return rows.map((row) => ({ id: row.id, name: row.name, type: row.type }));
}

/** What a tile or list row needs from the browser to behave. */
export interface BrowserController {
  folderId: string;
  selection: Set<string>;
  /** Touch selection mode: every tile shows its checkbox. */
  selectionMode: boolean;
  focusedId: string | null;
  renamingId: string | null;
  moving: boolean;
  /** Selects, and opens when it is the second click on the same row. */
  onRowClick: (row: BrowserRow, event: MouseEvent) => void;
  onToggleSelect: (row: BrowserRow) => void;
  onOpen: (row: BrowserRow) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (row: BrowserRow, name: string) => void;
  onCancelRename: () => void;
  onDelete: (rows: BrowserRow[]) => void;
  onUndoDelete: (id: string) => void;
  onMove: (rows: BrowserRow[], targetFolderId: string) => void;
  onDownload: (rows: BrowserRow[]) => void;
  onDragStart: (row: BrowserRow, event: DragEvent) => void;
  onDragEnd: () => void;
  onDropInto: (folderId: string, event: DragEvent) => void;
  canDropInto: (folderId: string) => boolean;
  /** Long-press on touch: enter selection mode with this row selected. */
  onLongPress: (row: BrowserRow) => void;
  /** The row plus the rest of the selection when the row is part of it. */
  scopeOf: (row: BrowserRow) => BrowserRow[];
}

export function useBrowserController(folderId: string) {
  const router = useRouter();
  const state: FolderView = useFolder(folderId);

  const [view, setView] = usePreference<View>("view", "grid", VIEWS);
  const [density, setDensity] = usePreference<Density>(
    "density",
    "comfortable",
    DENSITIES,
  );
  const [sortKey, setSortKey] = usePreference<SortKey>(
    "sort",
    "name",
    SORT_KEYS,
  );
  const [sortDirection, setSortDirection] = usePreference<SortDirection>(
    "sort-direction",
    "asc",
    SORT_DIRECTIONS,
  );
  const [foldersFirstRaw, setFoldersFirstRaw] = usePreference<"yes" | "no">(
    "folders-first",
    "yes",
    FOLDERS_FIRST,
  );
  const foldersFirst = foldersFirstRaw === "yes";
  const setFoldersFirst = useCallback(
    (value: boolean) => setFoldersFirstRaw(value ? "yes" : "no"),
    [setFoldersFirstRaw],
  );

  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [deepLinkFile, setDeepLinkFile] = useState<StorageFile | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [moving, setMoving] = useState(false);

  const paneRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const anchorIndex = useRef<number | null>(null);
  const dragDepth = useRef(0);
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = useMemo(
    () =>
      sortRows(
        toRows(state.subfolders, state.files),
        sortKey,
        sortDirection,
        foldersFirst,
      ),
    [state.subfolders, state.files, sortKey, sortDirection, foldersFirst],
  );
  const rowsById = useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );
  const deleteAtById = useMemo(() => {
    const map = new Map<string, number>();
    for (const folder of state.subfolders) {
      if (folder.deleteAt !== null) map.set(folder.id, folder.deleteAt);
    }
    for (const file of state.files) {
      if (file.deleteAt !== null) map.set(file.id, file.deleteAt);
    }
    return map;
  }, [state.subfolders, state.files]);
  const pendingIds = useMemo(() => {
    const set = new Set<string>();
    for (const folder of state.subfolders)
      if (folder.pending) set.add(folder.id);
    for (const file of state.files) if (file.pending) set.add(file.id);
    return set;
  }, [state.subfolders, state.files]);

  // Geometry mirrors the row/tile classes; it only has to be close enough to
  // keep the scrollbar honest and the overscan covering the gap.
  const rowWindow = useWindowedRows({
    count: rows.length,
    scrollRef,
    estimateLineHeight:
      view === "list"
        ? density === "compact"
          ? 36
          : 44
        : (tileWidth) =>
            // Thumbnail box + two name lines + one meta line + padding.
            tileWidth * (density === "compact" ? 1 : 0.75) +
            (density === "compact" ? 52 : 64),
    minTileWidth: view === "grid" ? (density === "compact" ? 128 : 168) : 0,
    // Mirrors the grid's `gap-2 p-3` below.
    tileGap: 8,
    gridPaddingX: 24,
  });

  // A folder switch must not carry selection or an open preview across.
  useEffect(() => {
    setSelection(new Set());
    setSelectionMode(false);
    setFocusedId(null);
    setRenamingId(null);
    setCreating(false);
    anchorIndex.current = null;
  }, [folderId]);

  // A folder this client just created can answer 404 while the projection
  // catches up; the data layer re-resolves it by name and says where it went.
  useEffect(() => {
    if (state.relocatedTo) router.replace(`/folders/${state.relocatedTo}`);
  }, [state.relocatedTo, router]);

  // Deep links from search land straight on a file.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "preview",
    );
    if (requested) setPreviewId(requested);
  }, [folderId]);

  const syncPreviewUrl = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("preview", id);
    else url.searchParams.delete("preview");
    window.history.replaceState(null, "", url);
  }, []);

  const openPreview = useCallback(
    (id: string | null) => {
      setPreviewId(id);
      if (id === null) setDeepLinkFile(null);
      syncPreviewUrl(id);
    },
    [syncPreviewUrl],
  );

  const previewInPage =
    previewId !== null && state.files.some((file) => file.id === previewId);

  // Only the pages loaded so far live in `state.files`, but a search result can
  // point at a file well past the first page. Rather than paging until it turns
  // up, fetch that one file and preview it on its own.
  useEffect(() => {
    if (!previewId || previewInPage || state.loading) return;
    if (deepLinkFile?.id === previewId) return;
    let active = true;
    api
      .file(previewId)
      .then((file) => {
        if (active) setDeepLinkFile(file);
      })
      .catch((error: unknown) => {
        if (!active) return;
        toast.error("Couldn't open that file", {
          description: errorMessage(error),
        });
        openPreview(null);
      });
    return () => {
      active = false;
    };
  }, [previewId, previewInPage, state.loading, deepLinkFile, openPreview]);

  const previewFiles: StorageFile[] = useMemo(() => {
    if (previewInPage) {
      const order = new Map(rows.map((row, index) => [row.id, index]));
      return [...state.files]
        .filter((file) => file.deleteAt === null)
        .sort(
          (a, b) =>
            (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        );
    }
    return deepLinkFile ? [deepLinkFile] : [];
  }, [previewInPage, rows, state.files, deepLinkFile]);

  const clearSelection = useCallback(() => {
    setSelection(new Set());
    setSelectionMode(false);
    anchorIndex.current = null;
  }, []);

  const scopeOf = useCallback(
    (row: BrowserRow): BrowserRow[] => {
      if (!selection.has(row.id) || selection.size <= 1) return [row];
      return rows.filter((candidate) => selection.has(candidate.id));
    },
    [rows, selection],
  );

  const selectedRows = useMemo(
    () => rows.filter((row) => selection.has(row.id)),
    [rows, selection],
  );

  const onPointerSelect = useCallback(
    (row: BrowserRow, event: MouseEvent) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      setFocusedId(row.id);
      if (event.shiftKey && anchorIndex.current !== null) {
        const [from, to] = [anchorIndex.current, index].sort((a, b) => a - b);
        setSelection(
          new Set(rows.slice(from, to + 1).map((candidate) => candidate.id)),
        );
        return;
      }
      if (event.metaKey || event.ctrlKey || selectionMode) {
        setSelection((current) => {
          const next = new Set(current);
          if (next.has(row.id)) next.delete(row.id);
          else next.add(row.id);
          return next;
        });
        anchorIndex.current = index;
        return;
      }
      anchorIndex.current = index;
      setSelection(new Set([row.id]));
    },
    [rows, selectionMode],
  );

  const onToggleSelect = useCallback(
    (row: BrowserRow) => {
      anchorIndex.current = rows.findIndex(
        (candidate) => candidate.id === row.id,
      );
      setSelection((current) => {
        const next = new Set(current);
        if (next.has(row.id)) next.delete(row.id);
        else next.add(row.id);
        return next;
      });
    },
    [rows],
  );

  const onOpen = useCallback(
    (row: BrowserRow) => {
      if (row.deleteAt !== null) {
        toast("That folder is being deleted", {
          action: {
            label: "Undo",
            onClick: () => storage.undoDelete(row.id),
          },
        });
        return;
      }
      if (row.type === "folder") {
        router.push(`/folders/${row.id}`);
        return;
      }
      openPreview(row.id);
    },
    [openPreview, router],
  );

  const onRowClick = useCallback(
    (row: BrowserRow, event: MouseEvent) => {
      const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey;
      const previous = lastClick.current;
      // On a phone a single tap opens; selection is entered by long-press.
      const coarse =
        typeof window !== "undefined" &&
        window.matchMedia("(pointer: coarse)").matches;
      if (coarse && !selectionMode && plain) {
        onOpen(row);
        return;
      }
      if (
        plain &&
        !selectionMode &&
        previous?.id === row.id &&
        event.timeStamp - previous.at <= DOUBLE_CLICK_MS
      ) {
        lastClick.current = null;
        onOpen(row);
        return;
      }
      lastClick.current = plain ? { id: row.id, at: event.timeStamp } : null;
      onPointerSelect(row, event);
    },
    [onOpen, onPointerSelect, selectionMode],
  );

  const onLongPress = useCallback((row: BrowserRow) => {
    setSelectionMode(true);
    setSelection((current) => new Set([...current, row.id]));
    setFocusedId(row.id);
  }, []);

  const onCommitRename = useCallback(
    async (row: BrowserRow, name: string) => {
      setRenamingId(null);
      try {
        if (row.type === "folder") {
          await storage.renameFolder(row.id, folderId, name);
        } else {
          await storage.renameFile(row.id, folderId, name);
        }
      } catch (error) {
        toast.error(`Couldn't rename ${row.name}`, {
          description: renameFailureCopy(error),
        });
      }
    },
    [folderId],
  );

  const onDelete = useCallback(
    (targets: BrowserRow[]) => {
      if (targets.length === 0) return;
      const entries = toEntries(targets);
      const subject =
        targets.length === 1
          ? (targets[0]?.name ?? "item")
          : pluralize(targets.length, "item");
      const { undo } = storage.scheduleDelete(entries, folderId, (failures) => {
        if (failures.length === 0) return;
        toast.error(`Couldn't delete ${pluralize(failures.length, "item")}`, {
          description: failures[0]?.message,
        });
      });
      clearSelection();
      setFocusedId(null);

      // The delete is still only local until the window closes, so the toast
      // counts down rather than claiming it is already gone. Undo has to stop
      // the countdown as well: re-rendering a dismissed toast by id revives it,
      // so a surviving interval puts the toast back a second after Undo.
      let countdown: ReturnType<typeof setInterval> | undefined;
      let toastId: string | number | undefined;
      const stopCountdown = () => {
        if (countdown) clearInterval(countdown);
        countdown = undefined;
      };
      const cancel = () => {
        stopCountdown();
        toast.dismiss(toastId);
        undo();
      };
      toastId = toast(`Deleting ${subject}`, {
        description: `${Math.round(UNDO_WINDOW_MS / 1000)}s to undo`,
        action: { label: "Undo", onClick: cancel },
        duration: UNDO_WINDOW_MS,
      });
      const deadline = Date.now() + UNDO_WINDOW_MS;
      countdown = setInterval(() => {
        const remaining = Math.ceil((deadline - Date.now()) / 1000);
        if (remaining <= 0) {
          stopCountdown();
          return;
        }
        toast(`Deleting ${subject}`, {
          id: toastId,
          description: `${remaining}s to undo`,
          action: { label: "Undo", onClick: cancel },
          duration: remaining * 1000,
        });
      }, 1000);
    },
    [clearSelection, folderId],
  );

  const runMove = useCallback(
    async (targets: BrowserRow[], targetFolderId: string) => {
      if (targets.length === 0 || targetFolderId === folderId) return;
      setMoving(true);
      const result = await storage.move(
        toEntries(targets),
        folderId,
        targetFolderId,
      );
      setMoving(false);
      clearSelection();
      if (result.failures.length > 0) {
        toast.error(
          `Couldn't move ${pluralize(result.failures.length, "item")}`,
          { description: result.failures[0]?.message },
        );
      } else if (result.moved > 0) {
        const subject =
          targets.length === 1
            ? (targets[0]?.name ?? "item")
            : pluralize(result.moved, "item");
        toast.success(`Moved ${subject}`, {
          action: {
            label: "Open",
            onClick: () => router.push(`/folders/${targetFolderId}`),
          },
        });
      }
    },
    [clearSelection, folderId, router],
  );

  const onDownload = useCallback(async (targets: BrowserRow[]) => {
    if (targets.length === 0) return;
    const single = targets[0];
    if (targets.length === 1 && single?.type === "file") {
      triggerDownload(api.url.fileDownload(single.id), single.name);
      return;
    }
    const label =
      targets.length === 1 && single
        ? single.name
        : pluralize(targets.length, "item");
    const toastId = toast.custom(
      () =>
        ArchiveToastCard({
          label: `Zipping ${label}`,
          progress: { writtenBytes: 0, totalBytes: 0, percent: 0 },
        }),
      { duration: Number.POSITIVE_INFINITY },
    );
    try {
      await downloadArchive(
        {
          fileIds: targets
            .filter((row) => row.type === "file")
            .map((row) => row.id),
          folderIds: targets
            .filter((row) => row.type === "folder")
            .map((row) => row.id),
        },
        (progress) =>
          toast.custom(
            () => ArchiveToastCard({ label: `Zipping ${label}`, progress }),
            { id: toastId, duration: Number.POSITIVE_INFINITY },
          ),
      );
      // Dismissing first: sonner keeps the custom node when a toast is updated
      // in place, so the success message would never replace the card.
      toast.dismiss(toastId);
      toast.success("Your ZIP is ready");
    } catch (error) {
      toast.dismiss(toastId);
      toast.error("Couldn't build that ZIP", {
        description: errorMessage(error),
      });
    }
  }, []);

  const controller: BrowserController = {
    // A folder cannot swallow itself or anything currently being dragged —
    // the server rejects it as CIRCULAR_MOVE, so refusing the drop outright
    // beats letting it land and reporting a failure.
    canDropInto: (targetId) => {
      if (targetId === folderId || selection.has(targetId)) return false;
      if (deleteAtById.has(targetId)) return false;
      const drag = activeDrag();
      return !drag?.entries.some((entry) => entry.id === targetId);
    },
    focusedId,
    folderId,
    moving,
    onCancelRename: () => setRenamingId(null),
    onCommitRename: (row, name) => void onCommitRename(row, name),
    onDelete,
    onDownload: (targets) => void onDownload(targets),
    onDragEnd: endDrag,
    onDragStart: (row, event) => {
      const scope = scopeOf(row);
      beginDrag(event.dataTransfer, {
        entries: toEntries(scope),
        sourceFolderId: folderId,
      });
    },
    onDropInto: (targetFolderId, event) => {
      const payload = readDrop(event.dataTransfer);
      endDrag();
      if (!payload) return;
      const targets = payload.entries
        .map((entry) => rowsById.get(entry.id))
        .filter((row): row is BrowserRow => row !== undefined);
      void runMove(targets, targetFolderId);
    },
    onLongPress,
    onMove: (targets, targetFolderId) => void runMove(targets, targetFolderId),
    onOpen,
    onRowClick,
    onStartRename: setRenamingId,
    onToggleSelect,
    onUndoDelete: (id) => {
      storage.undoDelete(id);
    },
    renamingId,
    scopeOf,
    selection,
    selectionMode,
  };

  const startUpload = useCallback(
    (files: { file: File; relativeDir: string }[]) => {
      if (files.length === 0 || !state.folder) return;
      uploads.add(files, folderId, state.folder.path);
    },
    [folderId, state.folder],
  );

  const onPaneDrop = async (event: DragEvent) => {
    dragDepth.current = 0;
    setDropActive(false);
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    startUpload(await readDataTransfer(event.dataTransfer));
  };

  const paneHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      dragDepth.current += 1;
      setDropActive(true);
    },
    onDragOver: (event: DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDropActive(false);
    },
    onDrop: (event: DragEvent) => void onPaneDrop(event),
  };

  /** Long-press detection for touch pointers; a move or lift cancels it. */
  const longPressHandlers = (row: BrowserRow) => ({
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (longPress.current) clearTimeout(longPress.current);
      longPress.current = setTimeout(() => {
        longPress.current = null;
        onLongPress(row);
      }, LONG_PRESS_MS);
    },
    onPointerMove: () => {
      if (longPress.current) clearTimeout(longPress.current);
      longPress.current = null;
    },
    onPointerUp: () => {
      if (longPress.current) clearTimeout(longPress.current);
      longPress.current = null;
    },
    onPointerCancel: () => {
      if (longPress.current) clearTimeout(longPress.current);
      longPress.current = null;
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (renamingId || creating || previewId) return;
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const index = focusedId
      ? rows.findIndex((row) => row.id === focusedId)
      : -1;
    const focusRow = (nextIndex: number) => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, nextIndex))];
      if (!row) return;
      const rowIndex = rows.indexOf(row);
      setFocusedId(row.id);
      anchorIndex.current = rowIndex;
      if (!event.shiftKey) setSelection(new Set([row.id]));
      else setSelection((current) => new Set([...current, row.id]));
      // A windowed row is not in the DOM yet, so scrollIntoView would silently
      // do nothing; the computed offset works either way.
      rowWindow.scrollToIndex(rowIndex);
      paneRef.current
        ?.querySelector(`[data-row-id="${row.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    };
    const columns = view === "grid" ? Math.max(1, rowWindow.columns) : 1;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(index < 0 ? 0 : index + columns);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(index < 0 ? 0 : Math.max(0, index - columns));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusRow(index < 0 ? 0 : index - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusRow(rows.length - 1);
      return;
    }
    if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      setSelection(new Set(rows.map((row) => row.id)));
      return;
    }
    if (event.key === "Escape") {
      clearSelection();
      setFocusedId(null);
      return;
    }
    if (event.key === "Enter") {
      const row = index >= 0 ? rows[index] : undefined;
      if (row) {
        event.preventDefault();
        onOpen(row);
      }
      return;
    }
    if (event.key === " ") {
      const row = index >= 0 ? rows[index] : undefined;
      if (row) {
        event.preventDefault();
        onToggleSelect(row);
      }
      return;
    }
    if (event.key === "F2") {
      const row = index >= 0 ? rows[index] : undefined;
      if (row) {
        event.preventDefault();
        setRenamingId(row.id);
      }
      return;
    }
    if (event.key === "Backspace" && state.folder?.parentId) {
      event.preventDefault();
      router.push(`/folders/${state.folder.parentId}`);
      return;
    }
    if (event.key === "Delete") {
      event.preventDefault();
      onDelete(
        selectedRows.length > 0
          ? selectedRows
          : rows.filter((row) => row.id === focusedId),
      );
    }
  };

  // The draft row renders at the top of the list, so it is off-screen when the
  // request came from a right-click halfway down the folder.
  const startCreateFolder = useCallback(() => {
    setCreating(true);
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const [createError, setCreateError] = useState<string | null>(null);
  const createFolder = async (name: string) => {
    setCreateError(null);
    try {
      const folder = await storage.createFolder(folderId, name);
      setCreating(false);
      toast.success(`Created ${folder.name}`, {
        action: {
          label: "Open",
          onClick: () => router.push(`/folders/${folder.id}`),
        },
      });
    } catch (error) {
      // A conflict keeps the editor open with the reason under it rather
      // than toasting; the person is still typing the name.
      setCreateError(createFailureCopy(error, name));
    }
  };

  const renameFolder = useCallback(
    async (name: string) => {
      if (!state.folder || state.folder.parentId === null) return;
      try {
        await storage.renameFolder(folderId, state.folder.parentId, name);
      } catch (error) {
        toast.error(`Couldn't rename ${state.folder.name}`, {
          description: renameFailureCopy(error),
        });
      }
    },
    [folderId, state.folder],
  );

  return {
    cameraInputRef,
    clearSelection,
    controller,
    createError,
    createFolder,
    creating,
    deleteAtById,
    density,
    dropActive,
    filesInputRef,
    folderId,
    folderInputRef,
    foldersFirst,
    longPressHandlers,
    moving,
    onDelete,
    onDownload,
    onKeyDown,
    openPreview,
    paneHandlers,
    paneRef,
    pendingIds,
    photosInputRef,
    previewFiles,
    previewId,
    renameFolder,
    rowWindow,
    rows,
    runMove,
    scrollRef: scrollRef as RefObject<HTMLDivElement | null>,
    selectedRows,
    selection,
    selectionMode,
    setCreating,
    setDensity,
    setFoldersFirst,
    setSelection,
    setSortDirection,
    setSortKey,
    setView,
    sortDirection,
    sortKey,
    startCreateFolder,
    startUpload,
    state,
    view,
  };
}

export type BrowserState = ReturnType<typeof useBrowserController>;

/** API codes mapped to a sentence a person can act on. */
export function createFailureCopy(error: unknown, name: string): string {
  const message = errorMessage(error);
  if (/FOLDER_EXISTS|already exists/i.test(message)) {
    return `A folder called ${name} already exists here`;
  }
  if (/INVALID_NAME|invalid/i.test(message)) {
    return "That name can't be used — try one without / or leading dots";
  }
  return message;
}

export function renameFailureCopy(error: unknown): string {
  const message = errorMessage(error);
  if (/already exists/i.test(message)) {
    return "Something with that name already exists here";
  }
  if (/CIRCULAR/i.test(message)) {
    return "A folder can't be moved into itself";
  }
  return message;
}

export function useReadFileInput(
  ref: RefObject<HTMLInputElement | null>,
  startUpload: (files: { file: File; relativeDir: string }[]) => void,
) {
  return {
    ref,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) startUpload(readFileList(event.target.files));
      event.target.value = "";
    },
  };
}
