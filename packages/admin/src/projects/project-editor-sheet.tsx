"use client";

import type { IProject } from "@repo/schemas";
import { ScrollArea } from "@repo/ui/scroll-area";
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
      <SheetContent className="w-full sm:max-w-2xl overflow-hidden p-0">
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
