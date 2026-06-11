import type {
  ISubResource,
  SubResourceCheck,
} from "@/models/resource-db/SubResource";

type ParsedCheck = { value: SubResourceCheck } | { error: string };

export function parseSubResourceCheck(input: unknown): ParsedCheck {
  if (input == null || typeof input !== "object") {
    return { error: "Check config is required" };
  }
  const check = input as Record<string, unknown>;

  if (check.type === "http") {
    if (typeof check.url !== "string" || !/^https?:\/\//.test(check.url)) {
      return { error: "HTTP check requires a valid url" };
    }
    const expectStatus =
      typeof check.expectStatus === "number" ? check.expectStatus : null;
    const expectJsonPath =
      typeof check.expectJsonPath === "string" && check.expectJsonPath.trim()
        ? check.expectJsonPath.trim()
        : null;
    const expectEquals =
      typeof check.expectEquals === "string" && check.expectEquals.trim()
        ? check.expectEquals.trim()
        : null;
    if ((expectJsonPath === null) !== (expectEquals === null)) {
      return {
        error: "expectJsonPath and expectEquals must be provided together",
      };
    }
    return {
      value: {
        type: "http",
        url: check.url,
        expectStatus,
        expectJsonPath,
        expectEquals,
      },
    };
  }

  if (check.type === "tcp") {
    if (typeof check.host !== "string" || !check.host.trim()) {
      return { error: "TCP check requires a host" };
    }
    if (
      typeof check.port !== "number" ||
      !Number.isInteger(check.port) ||
      check.port < 1 ||
      check.port > 65535
    ) {
      return { error: "TCP check requires a port between 1 and 65535" };
    }
    return {
      value: { type: "tcp", host: check.host.trim(), port: check.port },
    };
  }

  return { error: "Check type must be 'http' or 'tcp'" };
}

export function serializeSubResource(s: {
  _id: { toString(): string };
  parentResourceId: { toString(): string };
  name: string;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  check: SubResourceCheck;
  lastCheckedAt: Date | null;
  lastStatus: ISubResource["lastStatus"];
  lastResponseTimeMs: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    _id: s._id.toString(),
    parentResourceId: s.parentResourceId.toString(),
    name: s.name,
    description: s.description,
    isActive: s.isActive,
    isPublic: s.isPublic,
    check: s.check,
    lastCheckedAt: s.lastCheckedAt ? s.lastCheckedAt.toISOString() : null,
    lastStatus: s.lastStatus,
    lastResponseTimeMs: s.lastResponseTimeMs,
    createdAt: s.createdAt?.toISOString() ?? null,
    updatedAt: s.updatedAt?.toISOString() ?? null,
  };
}
