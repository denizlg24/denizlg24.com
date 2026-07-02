"use client";

import type { ICourse, ICourseDetail, ICourseOptions } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { Separator } from "@repo/ui/separator";
import { ArrowLeft, GraduationCap, Loader2, Plus, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { CourseForm, type CourseFormValues } from "./course-form";

const EMPTY_OPTIONS: ICourseOptions = {
  timetableEntries: [],
  calendarEvents: [],
  kanbanBoards: [],
  notes: [],
  people: [],
  resources: [],
};

interface CourseEditorPageProps {
  mode: "create" | "edit";
  courseId?: string;
  routeBasePath: string;
}

function normalizeBasePath(path: string) {
  return path.replace(/\/$/, "");
}

function EditorSkeleton({ title }: { title: string }) {
  const { slots } = useAdmin();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<GraduationCap className="size-4 text-muted-foreground" />}
        title={title}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="h-28 animate-pulse rounded-md border bg-muted/30" />
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-44 animate-pulse rounded-md border bg-muted/30"
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CourseEditorPage({
  mode,
  courseId,
  routeBasePath,
}: CourseEditorPageProps) {
  const { client, slots } = useAdmin();
  const router = useRouter();
  const basePath = normalizeBasePath(routeBasePath);

  const [course, setCourse] = useState<ICourse | null>(null);
  const [options, setOptions] = useState<ICourseOptions>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === "edit" && courseId) {
        const [detailResult, optionsResult] = await Promise.all([
          client.get<{ detail: ICourseDetail }>(`courses/${courseId}`),
          client.get<{ options: ICourseOptions }>("courses/options"),
        ]);
        setCourse(detailResult.detail.course);
        setOptions(optionsResult.options);
      } else {
        const optionsResult = await client.get<{ options: ICourseOptions }>(
          "courses/options",
        );
        setOptions(optionsResult.options);
      }
    } catch {
      toast.error(
        mode === "edit" ? "Failed to load class" : "Failed to load form data",
      );
      setOptions(EMPTY_OPTIONS);
    } finally {
      setLoading(false);
    }
  }, [client, courseId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const goBack = () => {
    router.push(basePath);
  };

  const handleSubmit = async (values: CourseFormValues) => {
    setSaving(true);
    try {
      if (mode === "edit") {
        if (!courseId) return;
        await client.patch<{ course: ICourse }>(`courses/${courseId}`, values);
        toast.success("Course saved");
      } else {
        await client.post<{ course: ICourse }>("courses", values);
        toast.success("Course created");
      }
      router.push(basePath);
    } catch {
      toast.error(
        mode === "edit" ? "Failed to save course" : "Failed to create course",
      );
    } finally {
      setSaving(false);
    }
  };

  const title = mode === "edit" ? "Edit Class" : "Add Class";

  if (loading) {
    return <EditorSkeleton title={title} />;
  }

  if (mode === "edit" && !course) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2">
        <PageHeader
          leading={slots?.sidebarTrigger}
          icon={<GraduationCap className="size-4 text-muted-foreground" />}
          title="Class not found"
        >
          <Button size="sm" variant="outline" onClick={goBack}>
            <ArrowLeft className="size-3.5" />
            Courses
          </Button>
        </PageHeader>
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          This class could not be loaded.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<GraduationCap className="size-4 text-muted-foreground" />}
        title={title}
      >
        <Button size="sm" variant="outline" onClick={goBack}>
          <ArrowLeft className="size-3.5" />
          Courses
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-5xl">
          <div className="mb-5 rounded-md border bg-card/60 p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {mode === "edit" ? (
                  <Save className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold">
                  {mode === "edit" && course ? course.name : "New class home"}
                </h1>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Configure the course profile, linked records, and manual
                  deadlines in one workspace.
                </p>
              </div>
              {saving && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Saving
                </div>
              )}
            </div>
          </div>

          <Separator className="mb-5" />

          <CourseForm
            initialCourse={course ?? undefined}
            options={options}
            onSubmit={handleSubmit}
            onCancel={goBack}
            isLoading={saving}
            mode={mode}
          />
        </div>
      </div>
    </div>
  );
}
