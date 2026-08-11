"use client";

import type { DeployTarget } from "@repo/schemas/cloud";
import { createContext, useContext } from "react";

export interface TargetContextValue {
  target: DeployTarget;
  /** Re-reads the target. Every settings write goes through it. */
  reload: () => Promise<unknown>;
}

/**
 * The layout already resolves the slug for the header and the sidebar, so the
 * section pages read the target from here rather than each opening its own poll
 * of the same row.
 */
export const TargetContext = createContext<TargetContextValue | null>(null);

export function useTarget(): TargetContextValue {
  const value = useContext(TargetContext);
  if (!value) throw new Error("useTarget outside the project layout");
  return value;
}

/** Every route under `/[project]` hangs off the slug, so build them from it. */
export function projectHref(slug: string, path = ""): string {
  const suffix = path.length > 0 ? `/${path.replace(/^\/+/, "")}` : "";
  return `/${encodeURIComponent(slug)}${suffix}`;
}
