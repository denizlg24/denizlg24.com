"use client";

import { Eye, EyeOff, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { ILeanProject } from "@/models/Project";
import { ProjectList } from "./project-list";

interface ProjectManagerProps {
  initialProjects: ILeanProject[];
}

export function ProjectManager({ initialProjects }: ProjectManagerProps) {
  const [projects, setProjects] = useState(initialProjects);
  const [filteredProjects, setFilteredProjects] = useState(initialProjects);
  const [visibilityFilter, setVisibilityFilter] = useState<string>("all");
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const fetchProjects = async () => {
    try {
      const response = await fetch("/api/admin/projects");
      if (!response.ok) {
        throw new Error("Failed to fetch projects");
      }
      const data = await response.json();
      setProjects(data.projects || []);
    } catch (error) {
      console.error("Error fetching projects:", error);
    }
  };

  useEffect(() => {
    let filtered = projects;

    if (visibilityFilter !== "all") {
      filtered = filtered.filter((project) =>
        visibilityFilter === "hidden" ? !project.isActive : project.isActive,
      );
    }

    setFilteredProjects(filtered);
    setHasUnsavedChanges(false);
  }, [projects, visibilityFilter]);

  const handleReorder = (newProjects: ILeanProject[]) => {
    setFilteredProjects(newProjects);
    setHasUnsavedChanges(true);
  };

  const handleSaveOrder = async () => {
    setSaving(true);
    try {
      const projectsWithNewOrder = filteredProjects.map((project, index) => ({
        _id: project._id,
        order: index,
      }));

      const response = await fetch("/api/admin/projects/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: projectsWithNewOrder }),
      });

      if (!response.ok) {
        throw new Error("Failed to save order");
      }

      await fetchProjects();
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error("Error saving order:", error);
      alert("Failed to save order. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex sm:flex-row flex-col sm:items-center items-start gap-2 justify-between w-full">
        <div className="">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            Projects Management
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Create and manage your projects displayed on the homepage.
            {" Drag items to reorder them."}
          </p>
        </div>
        <div className="flex gap-2 sm:w-fit w-full">
          {hasUnsavedChanges && (
            <Button
              variant="default"
              onClick={handleSaveOrder}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Order"}
            </Button>
          )}
          <Button asChild>
            <Link href="/admin/dashboard/projects/new">
              <Plus className="w-4 h-4 mr-2" />
              Create New
            </Link>
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="flex items-center gap-2 justify-end">
          <Label className="text-sm">Toggle Hidden:</Label>
          <Button
            variant={visibilityFilter === "hidden" ? "default" : "outline"}
            size="icon"
            onClick={() =>
              setVisibilityFilter(
                visibilityFilter === "hidden" ? "all" : "hidden",
              )
            }
            title={
              visibilityFilter === "hidden" ? "Show All" : "Show Hidden Only"
            }
          >
            {visibilityFilter === "hidden" ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </Button>
        </div>

        <ProjectList
          projects={filteredProjects}
          onRefresh={fetchProjects}
          onReorder={handleReorder}
        />
      </div>
    </>
  );
}
