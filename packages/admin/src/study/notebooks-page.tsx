"use client";

import type { NotebookSummary } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { SearchSelect } from "@repo/ui/search-select";
import { Skeleton } from "@repo/ui/skeleton";
import { FilterTabs, SearchField, ToolbarSpacer } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { type PickedSource, SourcePicker } from "./source-picker";
import {
  type CourseOption,
  createNotebook,
  listCourseOptions,
  listNotebooks,
} from "./study-api";
import { errorMessage, relativeTime, STUDY_ICON } from "./study-format";

type View = "active" | "archived";

const NO_COURSE = "__none__";

const COLUMNS = "hidden w-14 text-right sm:inline-block";

function ColumnHeads() {
  return (
    <div className="-mx-2 flex items-center gap-3 px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
      <span className="min-w-0 flex-1">Notebook</span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={COLUMNS}>Sources</span>
        <span className={COLUMNS}>Due</span>
        <span className={COLUMNS}>Decks</span>
        <span className={COLUMNS}>Quizzes</span>
        <span className="w-16 text-right">Updated</span>
      </span>
    </div>
  );
}

function NotebookRow({
  notebook,
  onOpen,
}: {
  notebook: NotebookSummary;
  onOpen: () => void;
}) {
  const course = [notebook.courseCode, notebook.courseName]
    .filter(Boolean)
    .join(" · ");
  return (
    <ListRow
      onClick={onOpen}
      leading={
        notebook.icon ? (
          <span className="text-base leading-none">{notebook.icon}</span>
        ) : (
          STUDY_ICON
        )
      }
      title={notebook.title}
      description={course || undefined}
      meta={
        <>
          <span className={COLUMNS}>{notebook.sourceCount}</span>
          <span
            className={cn(
              COLUMNS,
              notebook.cardsDue > 0 && "font-medium text-accent-strong",
            )}
          >
            {notebook.cardsDue || "—"}
          </span>
          <span className={COLUMNS}>{notebook.deckCount || "—"}</span>
          <span className={COLUMNS}>{notebook.quizCount || "—"}</span>
          <span className="w-16 text-right">
            {relativeTime(notebook.updatedAt)}
          </span>
        </>
      }
    />
  );
}

export function NotebooksSkeleton() {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={STUDY_ICON}
        title="Study"
      />
      <PageBody>
        <div className="flex flex-col gap-1">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-2">
              <Skeleton className="size-4" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/5" />
              </div>
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

export function NewNotebookDialog({
  open,
  onOpenChange,
  onCreated,
  defaultCourseId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (notebookId: string) => void;
  defaultCourseId?: string;
}) {
  const { client } = useAdmin();
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState(defaultCourseId ?? NO_COURSE);
  const [courses, setCourses] = useState<CourseOption[] | null>(null);
  const [sources, setSources] = useState<PickedSource[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    listCourseOptions(client)
      .then((result) => {
        if (live) setCourses(result);
      })
      .catch(() => {
        if (live) setCourses([]);
      });
    return () => {
      live = false;
    };
  }, [client, open]);

  const courseOptions = useMemo(
    () => [
      { value: NO_COURSE, label: "None" },
      ...(courses ?? []).map((course) => ({
        value: course._id,
        label: course.name,
        keywords: course.code,
        meta: course.code,
      })),
    ],
    [courses],
  );

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      const notebook = await createNotebook(client, {
        title: trimmed,
        ...(courseId !== NO_COURSE ? { courseId } : {}),
        ...(sources.length > 0
          ? {
              sources: sources.map((source) => ({
                kind: source.kind,
                id: source.id,
              })),
            }
          : {}),
      });
      onCreated(notebook._id);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create notebook"));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New notebook"
      onSubmit={submit}
      submitLabel="Create"
      submitDisabled={!title.trim()}
      pending={pending}
    >
      <FormGrid>
        <FormField label="Title" htmlFor="notebook-title">
          <Input
            id="notebook-title"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField label="Course" htmlFor="notebook-course">
          <SearchSelect
            id="notebook-course"
            value={courseId}
            onValueChange={setCourseId}
            options={courseOptions}
            disabled={courses === null}
          />
        </FormField>
      </FormGrid>
      <FormField label="Sources">
        <SourcePicker selected={sources} onChange={setSources} />
      </FormField>
    </FormDialog>
  );
}

export function NotebooksPage() {
  const { client, routes, slots } = useAdmin();
  const router = useRouter();
  const [view, setView] = useState<View>("active");
  const [notebooks, setNotebooks] = useState<NotebookSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setNotebooks(
          await listNotebooks(
            client,
            { archived: view === "archived" },
            { signal },
          ),
        );
      } catch (error) {
        if (signal?.aborted) return;
        toast.error(errorMessage(error, "Failed to load notebooks"));
        setNotebooks((current) => current ?? []);
      }
    },
    [client, view],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (notebooks ?? [])
      .filter((notebook) =>
        view === "archived" ? notebook.archivedAt : !notebook.archivedAt,
      )
      .filter(
        (notebook) =>
          !needle ||
          [notebook.title, notebook.courseCode, notebook.courseName]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(needle),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [notebooks, query, view]);

  if (!notebooks) return <NotebooksSkeleton />;

  const totalDue = visible.reduce(
    (sum, notebook) => sum + notebook.cardsDue,
    0,
  );

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={STUDY_ICON}
        title="Study"
      >
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New notebook
        </Button>
      </PageHeader>
      <PageToolbar>
        <SearchField value={query} onChange={setQuery} />
        <FilterTabs
          value={view}
          onChange={(next) => {
            setNotebooks(null);
            setView(next);
          }}
          options={[
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
          ]}
        />
        <ToolbarSpacer />
        {totalDue > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {totalDue} due
          </span>
        ) : null}
      </PageToolbar>
      <PageBody width="wide">
        {visible.length === 0 ? (
          <EmptyState
            icon={STUDY_ICON}
            label={query ? "0 results" : "No notebooks"}
          />
        ) : (
          <div className="flex flex-col">
            <ColumnHeads />
            <List divided>
              {visible.map((notebook) => (
                <NotebookRow
                  key={notebook._id}
                  notebook={notebook}
                  onOpen={() =>
                    router.push(routes.study.notebook(notebook._id))
                  }
                />
              ))}
            </List>
          </div>
        )}
      </PageBody>
      {creating ? (
        <NewNotebookDialog
          open
          onOpenChange={setCreating}
          onCreated={(notebookId) => {
            setCreating(false);
            router.push(routes.study.notebook(notebookId));
          }}
        />
      ) : null}
    </Page>
  );
}
