import type { Service } from "./model";

const definitions = [
  ["cloud", "Cloud", "Applications", "Your projects and databases."],
  ["forge", "Forge", "Applications", "Builds, deployments, and hosted apps."],
  ["storage", "Storage", "Applications", "Files, folders, and sharing."],
  [
    "web",
    "denizlg24.com",
    "Applications",
    "The website and personal workspace.",
  ],
  ["macros", "Macros", "Applications", "Meals and nutrition tracking."],
  ["envoy", "Envoy", "Applications", "Encrypted environment synchronization."],
  [
    "api",
    "Cloud API",
    "Infrastructure",
    "The API connecting Cloud, Forge, and Storage.",
  ],
  [
    "deep-health",
    "Deep health",
    "Infrastructure",
    "End-to-end transactions across core dependencies.",
  ],
  ["postgres", "PostgreSQL", "Data & storage", "Database transaction checks."],
  [
    "mongodb",
    "MongoDB",
    "Data & storage",
    "Document write, read, and delete checks.",
  ],
  ["redis", "Redis", "Data & storage", "Cache write, read, and delete checks."],
  [
    "posix",
    "File storage",
    "Data & storage",
    "Filesystem write, read, and cleanup checks.",
  ],
  [
    "objectStorage",
    "Object storage",
    "Data & storage",
    "Object storage write, read, and cleanup checks.",
  ],
  [
    "storageProtocol",
    "Storage protocol",
    "Data & storage",
    "Authenticated storage operations.",
  ],
  ["search", "Search", "Data & storage", "Indexing and retrieval checks."],
  [
    "meilisearch",
    "Meilisearch",
    "Infrastructure",
    "The full-text search engine.",
  ],
  [
    "mongot",
    "MongoDB search",
    "Infrastructure",
    "The database search sidecar.",
  ],
  ["disk", "Disk health", "Infrastructure", "Available disks and free space."],
  [
    "tunnel",
    "Network tunnel",
    "Infrastructure",
    "Connectivity to the home infrastructure.",
  ],
  [
    "deploy-agent",
    "Deployment engine",
    "Infrastructure",
    "Docker, build capacity, and deployment host health.",
  ],
] as const;
export const catalog: Service[] = definitions.map(
  ([id, name, group, description]) => ({
    id,
    name,
    group,
    description,
    status: "unknown",
    checkedAt: null,
    latencyMs: null,
    evidence: [],
  }),
);
export const groups = [
  "Applications",
  "Data & storage",
  "Infrastructure",
  "Other services",
];
export const appOrigins: Record<string, string> = {
  cloud: "https://cloud.denizlg24.com",
  forge: "https://forge.denizlg24.com",
  storage: "https://storage.denizlg24.com",
  web: "https://denizlg24.com",
  macros: "https://macros.denizlg24.com",
  envoy: "https://envoy.denizlg24.com",
};
export const drJobs = [
  {
    id: "dr:pi:backup",
    name: "Pi · backup & verification",
    profile: "pi",
    job: "backup",
  },
  {
    id: "dr:forge:backup",
    name: "Forge · backup & verification",
    profile: "forge",
    job: "backup",
  },
  {
    id: "dr:pi:r2-sync",
    name: "Pi · R2 offsite copy",
    profile: "pi",
    job: "r2-sync",
  },
  {
    id: "dr:forge:r2-sync",
    name: "Forge · R2 offsite copy",
    profile: "forge",
    job: "r2-sync",
  },
  {
    id: "dr:pi:r2-retention",
    name: "Pi · R2 retention",
    profile: "pi",
    job: "r2-retention",
  },
  {
    id: "dr:forge:r2-retention",
    name: "Forge · R2 retention",
    profile: "forge",
    job: "r2-retention",
  },
  {
    id: "dr:mac:icloud",
    name: "iCloud · independent copy",
    profile: "mac",
    job: "icloud",
  },
] as const;
