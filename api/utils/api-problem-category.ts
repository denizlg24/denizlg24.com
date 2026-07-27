interface ApiProblemCategory {
  pattern: RegExp;
  label: string;
  methods?: readonly string[];
}

const API_PROBLEM_CATEGORIES = [
  {
    pattern: /^\/api\/auth\/github\/(?:device|token)\/?$/,
    label: "Problems logging in",
  },
  {
    pattern: /^\/api\/projects\/?$/,
    label: "Problems creating projects",
    methods: ["POST"],
  },
  {
    pattern: /^\/api\/projects\/?$/,
    label: "Project API problems",
  },
  {
    pattern: /^\/api\/projects\/[^/]+\/members(?:\/[^/]+)?\/?$/,
    label: "Problems managing project members",
  },
  {
    pattern: /^\/api\/projects\/[^/]+\/head\/?$/,
    label: "Problems syncing project heads",
  },
  {
    pattern: /^\/api\/projects\/[^/]+\/blobs\/[^/]+\/upload\/?$/,
    label: "Problems uploading blobs",
  },
  {
    pattern: /^\/api\/projects\/[^/]+\/blobs\/[^/]+\/download\/?$/,
    label: "Problems downloading blobs",
  },
  {
    pattern: /^\/api\/projects\/[^/]+\/blobs\/[^/]+\/access\/?$/,
    label: "Problems managing file access",
  },
  {
    pattern: /^\/api\/health\/?$/,
    label: "API health check problems",
  },
] as const satisfies readonly ApiProblemCategory[];

const API_PROBLEM_CATEGORY_LABELS = new Set<string>(
  API_PROBLEM_CATEGORIES.map((category) => category.label)
);

export function getApiProblemCategory(pathOrUrl: string, method?: string) {
  if (API_PROBLEM_CATEGORY_LABELS.has(pathOrUrl)) {
    return pathOrUrl;
  }

  const path = normalizePath(pathOrUrl);
  const normalizedMethod = method?.toUpperCase();

  for (const category of API_PROBLEM_CATEGORIES) {
    const methods = "methods" in category ? category.methods as readonly string[] : undefined;

    if (
      category.pattern.test(path) &&
      (!methods || methods.includes(normalizedMethod ?? ""))
    ) {
      return category.label;
    }
  }

  return "API request problems";
}

function normalizePath(pathOrUrl: string) {
  let path = pathOrUrl;

  try {
    path = new URL(pathOrUrl).pathname;
  } catch {
    path = pathOrUrl.split(/[?#]/, 1)[0] || "/";
  }

  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
