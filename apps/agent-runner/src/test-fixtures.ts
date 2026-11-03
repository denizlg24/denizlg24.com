import { type ClaimedRun, DEFAULT_RUN_CONFIG } from "@repo/schemas";

export function claimedRun(overrides: Partial<ClaimedRun> = {}): ClaimedRun {
  return {
    runId: "6720f0a1b2c3d4e5f6a7b8c9",
    sprint: {
      id: "6720f0a1b2c3d4e5f6a7b800",
      title: "Sprint e2e",
      goal: "Add a file.",
      repo: "denizlg24/sprint-e2e",
      baseBranch: "main",
      branch: "sprint/e2e-ab12",
    },
    slot: {
      id: "6720f0a1b2c3d4e5f6a7b801",
      kind: "implement",
      title: "Add hello.txt",
      task: "Create hello.txt containing hello.",
    },
    config: { ...DEFAULT_RUN_CONFIG },
    context: "# Sprint e2e\n",
    ...overrides,
  };
}
