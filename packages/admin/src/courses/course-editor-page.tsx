"use client";

import type { ICourse, ICourseDetail, ICourseOptions } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { type Crumb, Page, PageBody, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { GraduationCap } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
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
}

function EditorChrome({
  title,
  crumbs,
  children,
}: {
  title: ReactNode;
  crumbs: Crumb[];
  children: ReactNode;
}) {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={crumbs}
        icon={<GraduationCap />}
        title={title}
      />
      <PageBody>{children}</PageBody>
    </Page>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-7 w-64" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CourseEditorPage({ mode, courseId }: CourseEditorPageProps) {
  const { client, routes } = useAdmin();
  const router = useRouter();

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
        mode === "edit" ? "Failed to load course" : "Failed to load form data",
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
    router.push(
      courseId ? routes.courses.detail(courseId) : routes.courses.root,
    );
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
      goBack();
    } catch {
      toast.error(
        mode === "edit" ? "Failed to save course" : "Failed to create course",
      );
    } finally {
      setSaving(false);
    }
  };

  const crumbs: Crumb[] = [
    { label: "Courses", onClick: () => router.push(routes.courses.root) },
    ...(mode === "edit" && course
      ? [{ label: course.name, onClick: goBack }]
      : []),
  ];
  const title = mode === "edit" ? "Edit" : "New course";

  if (loading) {
    return (
      <EditorChrome crumbs={crumbs} title={title}>
        <EditorSkeleton />
      </EditorChrome>
    );
  }

  if (mode === "edit" && !course) {
    return (
      <EditorChrome crumbs={crumbs} title="Not found">
        <EmptyState
          icon={<GraduationCap />}
          label="Course not found"
          action={
            <Button size="sm" variant="outline" onClick={goBack}>
              Courses
            </Button>
          }
        />
      </EditorChrome>
    );
  }

  return (
    <EditorChrome crumbs={crumbs} title={title}>
      <CourseForm
        initialCourse={course ?? undefined}
        options={options}
        onSubmit={handleSubmit}
        onCancel={goBack}
        isLoading={saving}
        mode={mode}
      />
    </EditorChrome>
  );
}
