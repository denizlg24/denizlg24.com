"use client";

import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TemplateProps } from ".";

interface QuickLink {
  id: string;
  label: string;
  url: string;
}

const getFaviconUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return null;
  }
};

export const QuickLinksTemplate = ({
  width,
  height,
  data,
  onDataChange,
}: TemplateProps) => {
  const title = (data.title as string) || "Quick Links";
  const links = (data.links as QuickLink[]) || [];
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitleInput, setNewTitleInput] = useState(title);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const updateLinks = (newLinks: QuickLink[]) => {
    onDataChange({ ...data, links: newLinks });
  };

  const addLink = () => {
    if (!newLabel.trim() || !newUrl.trim()) return;
    let url = newUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    const newLink: QuickLink = {
      id: Date.now().toString(),
      label: newLabel.trim(),
      url,
    };
    updateLinks([...links, newLink]);
    setNewLabel("");
    setNewUrl("");
    setAdding(false);
  };

  return (
    <div
      className="border border-border bg-background shadow-sm rounded-lg flex flex-col"
      style={{ width, height }}
    >
      <div className="flex flex-col gap-0.5 w-full pt-3 px-3 pb-3 border-b bg-input/25 rounded-tl-lg rounded-tr-lg shrink-0">
        <div className="flex flex-row items-center justify-between">
          {editingTitle ? (
            <input
              className="text-base font-semibold focus:outline-none bg-surface rounded"
              value={newTitleInput}
              onChange={(e) => setNewTitleInput(e.target.value)}
              onBlur={() => {
                onDataChange({ ...data, title: newTitleInput });
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onDataChange({ ...data, title: newTitleInput });
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <p
              className="text-base font-semibold"
              onClick={() => setEditingTitle(true)}
            >
              {title}
            </p>
          )}
          <p className="text-accent text-sm">{links.length}</p>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 overflow-y-auto flex-1 py-1">
        {links.map((link) => (
          <div
            key={link.id}
            className="group flex flex-row items-center gap-2 px-3 py-1.5 hover:bg-surface/50 rounded mx-1"
          >
            <div className="size-5 shrink-0 flex items-center justify-center">
              {getFaviconUrl(link.url) ? (
                <img
                  src={getFaviconUrl(link.url) as string}
                  alt=""
                  className="size-4 rounded-sm"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <ExternalLink className="size-3.5 text-muted-foreground" />
              )}
            </div>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm truncate flex-1 hover:underline"
            >
              {link.label}
            </a>
            <span className="text-xs text-muted-foreground truncate max-w-[80px] hidden group-hover:inline">
              {(() => {
                try {
                  return new URL(link.url).hostname;
                } catch {
                  return "";
                }
              })()}
            </span>
            <Button
              onClick={() => updateLinks(links.filter((l) => l.id !== link.id))}
              variant="outline"
              size="icon-xs"
              className="hidden group-hover:flex ml-auto shrink-0"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {links.length === 0 && !adding && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm px-3">
            No links yet
          </div>
        )}
      </div>

      <div className="mt-auto w-full p-3 bg-input/25 border-t rounded-bl-lg rounded-br-lg shrink-0">
        {adding ? (
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addLink();
                if (e.key === "Escape") setAdding(false);
              }}
              autoFocus
            />
            <Input
              placeholder="https://..."
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addLink();
                if (e.key === "Escape") setAdding(false);
              }}
            />
            <div className="flex flex-row gap-2">
              <Button size="sm" className="flex-1" onClick={addLink}>
                Add
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAdding(false);
                  setNewLabel("");
                  setNewUrl("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setAdding(true)}
          >
            <Plus className="size-4 mr-1" /> Add Link
          </Button>
        )}
      </div>
    </div>
  );
};
