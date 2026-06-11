import { revalidatePath } from "next/cache";

export const PUBLIC_CONTENT_TARGETS = [
  "blog",
  "now",
  "projects",
  "timeline",
] as const;

export type PublicContentTarget = (typeof PUBLIC_CONTENT_TARGETS)[number];

type RevalidationDescriptor = {
  path: string;
  type?: "layout" | "page";
};

export const PUBLIC_CONTENT_REVALIDATION_PATHS = {
  blog: [{ path: "/blog" }, { path: "/blog/[slug]", type: "page" }],
  now: [{ path: "/now" }],
  projects: [
    { path: "/" },
    { path: "/projects" },
    { path: "/projects/[id]", type: "page" },
  ],
  timeline: [{ path: "/" }],
} as const satisfies Record<
  PublicContentTarget,
  readonly RevalidationDescriptor[]
>;

export function normalizePublicContentTargets(
  targets: PublicContentTarget[],
): PublicContentTarget[] {
  return [...new Set(targets)];
}

export function revalidatePublicContent(
  targets: PublicContentTarget[],
): PublicContentTarget[] {
  const normalizedTargets = normalizePublicContentTargets(targets);
  const invalidatedPaths = new Set<string>();

  for (const target of normalizedTargets) {
    for (const descriptor of PUBLIC_CONTENT_REVALIDATION_PATHS[target]) {
      const descriptorType = "type" in descriptor ? descriptor.type : undefined;
      const key = `${descriptor.path}:${descriptorType ?? "default"}`;
      if (invalidatedPaths.has(key)) continue;

      invalidatedPaths.add(key);
      revalidatePath(descriptor.path, descriptorType);
    }
  }

  return normalizedTargets;
}

export async function triggerPublicContentRevalidation(
  targets: PublicContentTarget[],
): Promise<void> {
  const normalizedTargets = normalizePublicContentTargets(targets);
  if (normalizedTargets.length === 0) return;

  const baseUrl = process.env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      "BETTER_AUTH_URL is required to trigger public content revalidation.",
    );
  }

  const revalidateSecret = process.env.REVALIDATE_SECRET?.trim();
  if (!revalidateSecret) {
    throw new Error(
      "REVALIDATE_SECRET is required to trigger public content revalidation.",
    );
  }

  const response = await fetch(new URL("/api/admin/revalidate", baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-revalidate-secret": revalidateSecret,
    },
    body: JSON.stringify({ targets: normalizedTargets }),
    cache: "no-store",
  });

  if (response.ok) return;

  const details = (await response.text()).trim();
  throw new Error(
    `Public content revalidation failed with status ${response.status}${
      details ? `: ${details}` : ""
    }`,
  );
}

export function revalidateBlogContent() {
  return revalidatePublicContent(["blog"]);
}

export function revalidateNowContent() {
  return revalidatePublicContent(["now"]);
}

export function revalidateProjectsContent() {
  return revalidatePublicContent(["projects"]);
}

export function revalidateTimelineContent() {
  return revalidatePublicContent(["timeline"]);
}
