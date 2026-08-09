/** User-facing routes keep deployable services inside the project they belong to. */
export function projectServiceHref(
  projectId: string,
  serviceId: string,
  path = "",
): string {
  const suffix = path.length > 0 ? `/${path.replace(/^\/+/, "")}` : "";
  return `/projects/${projectId}/services/${serviceId}${suffix}`;
}

export function newProjectServiceHref(projectId: string): string {
  return `/projects/${projectId}/services/new`;
}
