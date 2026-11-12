"use client";

import type { INote } from "@repo/schemas";
import { parseKnowledgeSourceKey } from "@repo/schemas";
import { FilterTabs } from "@repo/ui/toolbar";
import { useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { recordHref } from "../workspace/records";
import { workspaceNav } from "../workspace/refs";
import { KnowledgeSpaceGraph } from "./space-graph";
import {
  NoteStructureGraph,
  type NoteStructureGraphProps,
} from "./structure-graph";

type GraphMode = "structure" | "space";

// Survives the graph unmounting when a node click switches the page to its
// list view, so coming back lands on the same mode.
let lastMode: GraphMode = "structure";

const ENTITY_KIND = {
  note: "note",
  document: "study-document",
  "voice-note": "voice-note",
} as const;

export interface NotesGraphViewProps extends NoteStructureGraphProps {
  /** Unfiltered, so Space can open any note and highlight the filtered ones. */
  allNotes: INote[];
}

export function NotesGraphView({
  allNotes,
  ...structure
}: NotesGraphViewProps) {
  const { platform, routes } = useAdmin();
  const [mode, setModeState] = useState<GraphMode>(() => lastMode);
  const setMode = (next: GraphMode) => {
    lastMode = next;
    setModeState(next);
  };

  const filtered = structure.notes.length !== allNotes.length;
  const highlightKeys = useMemo(
    () =>
      filtered ? structure.notes.map((note) => `note:${note._id}`) : undefined,
    [filtered, structure.notes],
  );

  const openSource = (key: string) => {
    const parsed = parseKnowledgeSourceKey(key);
    if (!parsed) return;
    if (parsed.kind === "note") {
      const note = allNotes.find((candidate) => candidate._id === parsed.id);
      if (note) {
        structure.onSelectNote(note);
        return;
      }
    }
    const href = recordHref(
      workspaceNav(routes),
      `entity:${ENTITY_KIND[parsed.kind]}:${parsed.id}`,
    );
    if (href) void platform.navigate(href);
  };

  const modeSwitch = (
    <FilterTabs
      value={mode}
      onChange={setMode}
      options={[
        { value: "structure", label: "Structure" },
        { value: "space", label: "Space" },
      ]}
    />
  );

  if (mode === "space") {
    return (
      <KnowledgeSpaceGraph
        highlightKeys={highlightKeys}
        onSelect={openSource}
        toolbarStart={modeSwitch}
      />
    );
  }

  return (
    <div className="relative h-full w-full">
      <NoteStructureGraph {...structure} />
      <div className="absolute top-2 left-2 rounded-md bg-background/85 px-1 backdrop-blur-sm">
        {modeSwitch}
      </div>
    </div>
  );
}
