"use client";

import type { NotebookDetail } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { FormDialog, FormField } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Page, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { RowActions } from "@repo/ui/toolbar";
import { FilePlus2, FileUp, Repeat } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { KnowledgeSpaceGraph } from "../knowledge-graph/space-graph";
import { useAdmin } from "../provider";
import { NotebookDecks, NotebookQuizzes } from "./notebook-artifacts";
import { NotebookChat } from "./notebook-chat";
import {
  AddSourcesDialog,
  NotebookSources,
  useDocumentUploads,
} from "./notebook-sources";
import { deleteNotebook, getNotebook, updateNotebook } from "./study-api";
import {
  errorMessage,
  openStudySource,
  STUDY_ICON,
  withParam,
} from "./study-format";

export const NOTEBOOK_TABS = [
  "chat",
  "sources",
  "decks",
  "quizzes",
  "map",
] as const;
export type NotebookTab = (typeof NOTEBOOK_TABS)[number];

export function isNotebookTab(
  value: string | null | undefined,
): value is NotebookTab {
  return (NOTEBOOK_TABS as readonly string[]).includes(value ?? "");
}

const TAB_LABEL: Record<NotebookTab, string> = {
  chat: "Chat",
  sources: "Sources",
  decks: "Decks",
  quizzes: "Quizzes",
  map: "Map",
};

function ScrollBody({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-6 sm:px-8">
        {children}
      </div>
    </div>
  );
}

function useElementHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, height };
}

function NotebookMap({
  notebookId,
  highlightKeys,
}: {
  notebookId: string;
  highlightKeys: string[];
}) {
  const admin = useAdmin();
  const { ref, height } = useElementHeight();
  return (
    <div ref={ref} className="h-full min-h-0">
      {height ? (
        <KnowledgeSpaceGraph
          notebookId={notebookId}
          highlightKeys={highlightKeys}
          height={height}
          onSelect={(key) => void openStudySource(admin, { sourceKey: key })}
        />
      ) : null}
    </div>
  );
}

export function NotebookSkeleton() {
  const { slots, routes } = useAdmin();
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={[
          { label: "Study", onClick: () => router.push(routes.study.index) },
        ]}
        icon={STUDY_ICON}
        title={<Skeleton className="h-4 w-40" />}
      />
      <div className="flex h-10 items-center gap-4 border-b px-4">
        {NOTEBOOK_TABS.map((tab) => (
          <Skeleton key={tab} className="h-3 w-12" />
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end gap-3 p-4">
        <Skeleton className="h-24 w-full" />
      </div>
    </Page>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: string;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial);
  const [pending, setPending] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename notebook"
      submitDisabled={!title.trim()}
      pending={pending}
      onSubmit={async () => {
        setPending(true);
        try {
          await onSubmit(title.trim());
          onOpenChange(false);
        } finally {
          setPending(false);
        }
      }}
    >
      <FormField label="Title" htmlFor="notebook-rename">
        <Input
          id="notebook-rename"
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
    </FormDialog>
  );
}

export function NotebookPage({
  notebookId,
  tab: initialTab,
}: {
  notebookId: string;
  tab?: string | null;
}) {
  const { client, routes, slots } = useAdmin();
  const router = useRouter();
  const [detail, setDetail] = useState<NotebookDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<NotebookTab>(
    isNotebookTab(initialTab) ? initialTab : "chat",
  );
  const [highlightKeys, setHighlightKeys] = useState<string[]>([]);
  const [addingSources, setAddingSources] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setDetail(await getNotebook(client, notebookId, { signal }));
        loaded.current = true;
      } catch (error) {
        if (signal?.aborted) return;
        if (!loaded.current) setMissing(true);
        toast.error(errorMessage(error, "Failed to load notebook"));
      }
    },
    [client, notebookId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);
  const { uploads, start, dismiss } = useDocumentUploads(notebookId, refresh);

  const changeTab = (next: string) => {
    if (!isNotebookTab(next)) return;
    setTab(next);
    // History only, no navigation: the chat keeps streaming across tabs.
    window.history.replaceState(
      null,
      "",
      withParam(routes.study.notebook(notebookId), "tab", next),
    );
  };

  if (!detail) {
    if (missing) {
      return (
        <Page>
          <PageHeader
            leading={slots?.sidebarTrigger}
            crumbs={[
              {
                label: "Study",
                onClick: () => router.push(routes.study.index),
              },
            ]}
            icon={STUDY_ICON}
            title="Notebook"
          />
          <p className="py-16 text-center text-sm text-muted-foreground">—</p>
        </Page>
      );
    }
    return <NotebookSkeleton />;
  }

  const notebook = detail.notebook;
  const archived = Boolean(notebook.archivedAt);
  const course = notebook.courseCode ?? notebook.courseName;

  const update = async (body: Parameters<typeof updateNotebook>[2]) => {
    try {
      await updateNotebook(client, notebookId, body);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update notebook"));
    }
  };

  const remove = async () => {
    try {
      await deleteNotebook(client, notebookId);
      router.push(routes.study.index);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete notebook"));
    }
  };

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={[
          { label: "Study", onClick: () => router.push(routes.study.index) },
          ...(course && notebook.courseId
            ? [
                {
                  label: course,
                  onClick: () =>
                    router.push(routes.courses.detail(notebook.courseId ?? "")),
                },
              ]
            : []),
        ]}
        icon={
          notebook.icon ? (
            <span className="text-sm leading-none">{notebook.icon}</span>
          ) : (
            STUDY_ICON
          )
        }
        title={notebook.title}
      >
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            start(files);
            changeTab("sources");
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Upload PDF"
          onClick={() => fileInput.current?.click()}
        >
          <FileUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add sources"
          onClick={() => setAddingSources(true)}
        >
          <FilePlus2 />
        </Button>
        <Button
          size="sm"
          variant={notebook.cardsDue > 0 ? "default" : "outline"}
          disabled={notebook.cardCount === 0}
          onClick={() => router.push(routes.study.review(notebookId))}
        >
          <Repeat />
          Review
          <span className="tabular-nums opacity-80">{notebook.cardsDue}</span>
        </Button>
        <RowActions>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void update({ archived: !archived })}
          >
            {archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmDelete(true)}
          >
            Delete
          </DropdownMenuItem>
        </RowActions>
      </PageHeader>

      <Tabs
        value={tab}
        onValueChange={changeTab}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="flex h-10 shrink-0 items-center border-b px-3">
          <TabsList variant="line">
            {NOTEBOOK_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {TAB_LABEL[value]}
                {value === "sources" ? (
                  <span className="tabular-nums text-muted-foreground">
                    {notebook.sourceCount}
                  </span>
                ) : value === "decks" ? (
                  <span className="tabular-nums text-muted-foreground">
                    {detail.decks.length}
                  </span>
                ) : value === "quizzes" ? (
                  <span className="tabular-nums text-muted-foreground">
                    {detail.quizzes.length}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent
          value="chat"
          forceMount
          className="min-h-0 data-[state=inactive]:hidden"
        >
          <NotebookChat
            notebookId={notebookId}
            initialConversationId={detail.conversationId}
            onCitedKeys={setHighlightKeys}
          />
        </TabsContent>
        <TabsContent value="sources" className="min-h-0">
          <ScrollBody>
            <NotebookSources
              detail={detail}
              uploads={uploads}
              onDismissUpload={dismiss}
              onChange={setDetail}
            />
          </ScrollBody>
        </TabsContent>
        <TabsContent value="decks" className="min-h-0">
          <ScrollBody>
            <NotebookDecks
              notebookId={notebookId}
              decks={detail.decks}
              onChange={refresh}
            />
          </ScrollBody>
        </TabsContent>
        <TabsContent value="quizzes" className="min-h-0">
          <ScrollBody>
            <NotebookQuizzes
              notebookId={notebookId}
              quizzes={detail.quizzes}
              onChange={refresh}
            />
          </ScrollBody>
        </TabsContent>
        <TabsContent value="map" className="min-h-0">
          <NotebookMap notebookId={notebookId} highlightKeys={highlightKeys} />
        </TabsContent>
      </Tabs>

      {addingSources ? (
        <AddSourcesDialog
          open
          onOpenChange={setAddingSources}
          detail={detail}
          onSaved={setDetail}
        />
      ) : null}
      {renaming ? (
        <RenameDialog
          open
          onOpenChange={setRenaming}
          initial={notebook.title}
          onSubmit={(title) => update({ title })}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${notebook.title}?`}
        description={`${notebook.deckCount} decks, ${notebook.cardCount} cards, ${notebook.quizCount} quizzes`}
        actionLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </Page>
  );
}
