"use client";

import type { IProject } from "@repo/schemas";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { ProjectForm } from "./project-form";

export function ProjectEditorSheet({
  project,
  open,
  onOpenChange,
  onSaved,
}: {
  project: IProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (project: IProject) => void;
}) {
  if (!project) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="w-full pt-0 px-4 pb-6 max-w-full! overflow-x-auto px-2 pb-2 overflow-y-auto max-h-screen!"
      >
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="text-sm">Edit Project</SheetTitle>
          <SheetDescription className="sr-only">
            Edit project: {project.title}
          </SheetDescription>
        </SheetHeader>
        <ProjectForm
          mode="edit"
          project={project}
          onSuccess={(updated) => {
            onSaved(updated);
            onOpenChange(false);
          }}
          onCancel={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
