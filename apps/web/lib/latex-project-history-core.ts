import type { ILatexProject, LatexProjectChangedFile } from "@repo/schemas";

export function changedLatexFiles(
  previous: ILatexProject | null,
  next: ILatexProject,
): LatexProjectChangedFile[] {
  const previousFiles = new Map(
    (previous?.entries ?? []).flatMap((entry) =>
      entry.kind === "file" ? [[entry.path, entry]] : [],
    ),
  );
  const nextFiles = new Map(
    next.entries.flatMap((entry) =>
      entry.kind === "file" ? [[entry.path, entry]] : [],
    ),
  );
  const changes: LatexProjectChangedFile[] = [];

  for (const [path, file] of nextFiles) {
    const old = previousFiles.get(path);
    if (!old) changes.push({ path, status: "added" });
    else if (old.encoding !== file.encoding || old.content !== file.content) {
      changes.push({ path, status: "modified" });
    }
  }
  for (const path of previousFiles.keys()) {
    if (!nextFiles.has(path)) changes.push({ path, status: "deleted" });
  }
  if (
    previous &&
    previous.mainFile !== next.mainFile &&
    !changes.some((change) => change.path === next.mainFile)
  ) {
    changes.push({ path: next.mainFile, status: "modified" });
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

export function mergeLatexChangedFiles(
  previous: LatexProjectChangedFile[],
  next: LatexProjectChangedFile[],
): LatexProjectChangedFile[] {
  const merged = new Map(previous.map((change) => [change.path, change]));
  for (const change of next) merged.set(change.path, change);
  return [...merged.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}
