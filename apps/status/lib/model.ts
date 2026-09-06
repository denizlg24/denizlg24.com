export type Health =
  | "operational"
  | "degraded"
  | "down"
  | "unknown"
  | "maintenance";
export type Evidence = {
  source: string;
  status: Health;
  at: string;
  latencyMs: number | null;
  detail: string | null;
};
export type Service = {
  id: string;
  name: string;
  group: string;
  description: string;
  status: Health;
  checkedAt: string | null;
  latencyMs: number | null;
  evidence: Evidence[];
};
export type Backup = {
  id: string;
  name: string;
  provider: "cloud" | "dr";
  profile?: "pi" | "forge" | "mac";
  job?: "backup" | "r2-sync" | "r2-retention" | "icloud";
  status: "unknown" | "pending" | "running" | "completed" | "failed";
  reportedAt: string;
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  enabled: boolean;
  schedule: string | null;
  detail: string | null;
  verification: string | null;
};
export type Snapshot = {
  _id: string;
  at: string;
  services: Service[];
  backups: Backup[];
  warnings: string[];
};
export type Update = {
  id: string;
  at: string;
  author: string;
  visibility: "public" | "private";
  state: "investigating" | "identified" | "monitoring" | "resolved";
  text: string;
};
export type Incident = {
  _id: string;
  betterStackId: string | null;
  title: string;
  serviceIds: string[];
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  cause: string;
  evidence: Evidence[];
  updates: Update[];
  enrichmentSentAt?: string;
};
export type Maintenance = {
  _id: string;
  title: string;
  description: string;
  serviceIds: string[];
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  author: string;
};
export type Sample = {
  _id: string;
  serviceId: string;
  at: Date;
  status: Health;
  latencyMs: number | null;
  evidence: Evidence[];
};
export type Timing = {
  _id: string;
  serviceId: string;
  region: string;
  at: Date;
  total: number;
  dns: number | null;
  connection: number | null;
  tls: number | null;
  transfer: number | null;
};
export type Daily = {
  serviceId: string;
  day: string;
  operational: number;
  degraded: number;
  down: number;
  unknown: number;
};
export type Command = {
  _id: string;
  profile: "pi" | "forge" | "mac";
  job: "backup" | "r2-sync" | "r2-retention" | "icloud";
  action: "run" | "schedule";
  schedule: string | null;
  enabled: boolean | null;
  state: "queued" | "claimed" | "completed" | "failed";
  createdAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  actor: string;
  detail: string | null;
};
