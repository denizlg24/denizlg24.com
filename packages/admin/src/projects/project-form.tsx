"use client";

import { DEFAULT_PROJECT_TOPIC_GROUPS, type IProject } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Properties, Property } from "@repo/ui/properties";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import { Eye, Layers, Star, Tag, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { FaGithub } from "react-icons/fa6";
import { toast } from "sonner";
import { TagAutocomplete } from "../notes/tag-autocomplete";
import { useAdmin } from "../provider";
import {
  Chip,
  ChipInput,
  DocumentEditorShell,
  type EditableLink,
  ImagesSection,
  LeadField,
  LinksSection,
  MarkdownSection,
  TitleField,
} from "./document-editor";

interface ProjectFormProps {
  mode: "create" | "edit";
  project?: IProject;
  icon: ReactNode;
  backTo: string;
  backLabel: string;
  onSuccess: (project: IProject) => void;
  onDeleted?: () => void;
}

export function ProjectForm({
  mode,
  project,
  icon,
  backTo,
  backLabel,
  onSuccess,
  onDeleted,
}: ProjectFormProps) {
  const { client } = useAdmin();
  const [title, setTitle] = useState(project?.title ?? "");
  const [subtitle, setSubtitle] = useState(project?.subtitle ?? "");
  const [markdown, setMarkdown] = useState(project?.markdown ?? "");
  const [images, setImages] = useState<string[]>(project?.images ?? []);
  const [media, setMedia] = useState<string[]>(project?.media ?? []);
  const [tags, setTags] = useState<string[]>(project?.tags ?? []);
  const [topicGroups, setTopicGroups] = useState<string[]>(
    project?.topicGroups ?? [],
  );
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [links, setLinks] = useState<EditableLink[]>(
    project?.links?.map((l) => ({
      label: l.label,
      url: l.url,
      icon: l.icon,
    })) ?? [],
  );
  const [isActive, setIsActive] = useState(project?.isActive ?? true);
  const [isFeatured, setIsFeatured] = useState(project?.isFeatured ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    client
      .get<{ projects: IProject[] }>("projects")
      .then((result) => {
        if (!active) return;
        setTopicSuggestions(
          result.projects.flatMap((item) => item.topicGroups ?? []),
        );
      })
      .catch(() => {
        if (active) setTopicSuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [client]);

  const topicOptions = useMemo(
    () =>
      [
        ...new Set([
          ...DEFAULT_PROJECT_TOPIC_GROUPS,
          ...topicSuggestions,
          ...topicGroups,
        ]),
      ].sort((left, right) => left.localeCompare(right)),
    [topicGroups, topicSuggestions],
  );

  const handleTopicGroupsChange = (next: string[]) => {
    setTopicGroups(next);
    setTopicSuggestions((current) => [...new Set([...current, ...next])]);
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    if (!subtitle.trim()) {
      toast.error("Subtitle required");
      return;
    }

    setSaving(true);
    const body = {
      title: title.trim(),
      subtitle: subtitle.trim(),
      markdown: markdown.trim(),
      images,
      media,
      tags,
      topicGroups,
      links,
      isActive,
      isFeatured,
    };

    try {
      if (mode === "create") {
        const result = await client.post<{
          message: string;
          project: IProject;
        }>("projects", body);
        toast.success("Project created");
        onSuccess(result.project);
      } else if (project) {
        const result = await client.patch<{ project: IProject }>(
          `projects/${project._id}`,
          body,
        );
        toast.success("Project updated");
        onSuccess(result.project);
      }
    } catch {
      toast.error(
        mode === "create"
          ? "Failed to create project"
          : "Failed to update project",
      );
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!project) return;
    try {
      await client.del<{ message: string }>(`projects/${project._id}`);
      toast.success("Project deleted");
      onDeleted?.();
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const canSubmit =
    title.trim().length > 0 && subtitle.trim().length > 0 && !saving;
  const repository = project?.sourceRepository;

  return (
    <DocumentEditorShell
      icon={icon}
      backTo={backTo}
      backLabel={backLabel}
      title={mode === "edit" ? project?.title || "Untitled" : "New project"}
      actions={
        <>
          {mode === "edit" && project ? (
            <ConfirmButton
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete project"
                >
                  <Trash2 />
                </Button>
              }
              title="Delete project?"
              description={`“${project.title}” will be permanently deleted.`}
              actionLabel="Delete"
              destructive
              onConfirm={handleDelete}
            />
          ) : null}
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? <Spinner className="size-3.5" /> : null}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <TitleField value={title} onChange={setTitle} />
        <LeadField
          value={subtitle}
          onChange={setSubtitle}
          placeholder="Subtitle"
          label="Subtitle"
        />
      </div>

      <Properties>
        <Property icon={<Eye />} label="Published">
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label="Published"
          />
        </Property>
        <Property icon={<Star />} label="Featured">
          <Switch
            checked={isFeatured}
            onCheckedChange={setIsFeatured}
            aria-label="Featured"
          />
        </Property>
        <Property icon={<Tag />} label="Tags">
          <ChipInput
            values={tags}
            onChange={setTags}
            placeholder="Add tag"
            normalize={(value) => value.trim().toLowerCase()}
          />
        </Property>
        <Property icon={<Layers />} label="Topics">
          <div className="flex min-h-8 flex-wrap items-center gap-1 py-1">
            {topicGroups.map((topic) => (
              <Chip
                key={topic}
                label={topic}
                onRemove={() =>
                  handleTopicGroupsChange(
                    topicGroups.filter((item) => item !== topic),
                  )
                }
              />
            ))}
            <TagAutocomplete
              value={topicGroups}
              onChange={handleTopicGroupsChange}
              suggestions={topicOptions}
              placeholder="Add topic"
              searchPlaceholder="Search or create topic"
              emptyMessage="No topics"
              groupHeading="Topics"
              noun="topic"
              normalizeValue={(value) => value.trim()}
              normalizeKey={(value) => value.trim().toLowerCase()}
            />
          </div>
        </Property>
        {repository ? (
          <Property icon={<FaGithub />} label="Repository">
            <a
              href={repository.url}
              target="_blank"
              rel="noreferrer"
              className="truncate font-mono text-xs hover:underline"
            >
              {repository.owner}/{repository.repo}
              {repository.branch ? `#${repository.branch}` : ""}
            </a>
          </Property>
        ) : null}
      </Properties>

      <LinksSection links={links} onChange={setLinks} />

      <ImagesSection title="Images" urls={images} onChange={setImages} />

      <ImagesSection
        title="Media"
        urls={media}
        onChange={setMedia}
        columns={2}
      />

      <MarkdownSection value={markdown} onChange={setMarkdown} />
    </DocumentEditorShell>
  );
}
