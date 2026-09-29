import type { MacrosDistributionBuildDispatch } from "@repo/schemas/macros";

const WORKFLOW_FILE = "macros-mobile.yml";
const DEFAULT_REPOSITORY = "denizlg24/denizlg24.com";

/**
 * Starts the ad-hoc build so a freshly approved UDID lands in the next
 * profile. The workflow reads the approved list from this server itself;
 * `adhoc` only selects the signed ad-hoc release, which still waits for the
 * `macros-release` environment approval on GitHub.
 */
export async function dispatchAdhocBuild(): Promise<MacrosDistributionBuildDispatch> {
  const token = process.env.MACROS_GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) return "not-configured";

  const repository =
    process.env.MACROS_GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { adhoc: "true" } }),
      signal: AbortSignal.timeout(10_000),
    },
  ).catch((error: unknown) => {
    console.error("[distribution] workflow dispatch failed", error);
    return null;
  });

  if (!response?.ok) {
    if (response) {
      console.error(
        `[distribution] workflow dispatch answered ${response.status}: ${await response.text()}`,
      );
    }
    return "failed";
  }
  return "triggered";
}
