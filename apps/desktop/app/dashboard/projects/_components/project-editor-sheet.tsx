"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { denizApi } from "@/lib/api-wrapper";
import type { IProject } from "@/lib/data-types";
import { ProjectForm } from "./project-form";

export function ProjectEditorSheet({
  project,
  open,
  onOpenChange,
  api,
  onSaved,
}: {
  project: IProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: denizApi;
  onSaved: (project: IProject) => void;
}) {
  if (!project) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl overflow-hidden p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="text-sm">Edit Project</SheetTitle>
          <SheetDescription className="sr-only">
            Edit project: {project.title}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-4rem)] px-4 pb-6">
          <ProjectForm
            mode="edit"
            project={project}
            api={api}
            onSuccess={(updated) => {
              onSaved(updated);
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
