"use client";

import type { DeployTarget } from "@repo/schemas/cloud";
import { createContext, useContext } from "react";

export interface TargetContextValue {
  target: DeployTarget;
  /** Re-reads the target. Every settings write goes through it. */
  reload: () => Promise<unknown>;
}

/**
 * The layout already polls the target for the header and the sidebar, so the
 * section pages read it from here rather than each opening its own poll of the
 * same row — five sections meant five requests every interval.
 */
export const TargetContext = createContext<TargetContextValue | null>(null);

export function useTarget(): TargetContextValue {
  const value = useContext(TargetContext);
  if (!value) throw new Error("useTarget outside the deploy target layout");
  return value;
}
