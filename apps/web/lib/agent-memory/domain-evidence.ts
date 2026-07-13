import type {
  AgentActor,
  AgentSensitivity,
  AgentSourceType,
  AgentTrust,
  CreateAgentEvidenceEvent,
} from "@repo/schemas";
import mongoose from "mongoose";
import {
  buildEvidenceInput,
  observeEvidence,
  stableContentHash,
} from "./evidence";

export type AgentDomainKind =
  | "note"
  | "calendar"
  | "person"
  | "project"
  | "course"
  | "email-triage";

interface DomainPolicy {
  sourceType: AgentSourceType;
  entityType: string;
  actor: AgentActor;
  trust: AgentTrust;
  sensitivity: AgentSensitivity;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, max = 4_000): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function strings(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 256))
    .filter(Boolean)
    .slice(0, max);
}

function ids(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map(String);
}

function compactRecord(kind: AgentDomainKind, raw: Record<string, unknown>) {
  if (kind === "note") {
    return {
      title: text(raw.title, 500),
      content: text(raw.content, 5_000),
      description: text(raw.description, 1_000),
      url: text(raw.url, 1_000),
      siteName: text(raw.siteName, 300),
      tags: strings(raw.tags),
      groupIds: ids(raw.groupIds),
      status: raw.status,
      class: text(raw.class, 100),
    };
  }
  if (kind === "calendar") {
    const source = record(raw.source);
    return {
      title: text(raw.title, 500),
      place: text(raw.place, 500),
      date: raw.date,
      endDate: raw.endDate,
      calendarDate: raw.calendarDate,
      isAllDay: raw.isAllDay,
      kind: raw.kind,
      status: raw.status,
      source: source.provider
        ? { provider: source.provider, providerKey: source.providerKey }
        : undefined,
    };
  }
  if (kind === "person") {
    return {
      name: text(raw.name, 500),
      birthday: raw.birthday,
      placeMet: text(raw.placeMet, 500),
      notes: text(raw.notes, 4_000),
      groupIds: ids(raw.groupIds),
      email: text(raw.email, 500),
      phone: text(raw.phone, 100),
      website: text(raw.website, 1_000),
      address: text(raw.address, 1_000),
    };
  }
  if (kind === "project") {
    return {
      title: text(raw.title, 500),
      subtitle: text(raw.subtitle, 1_000),
      markdown: text(raw.markdown, 5_000),
      tags: strings(raw.tags),
      topicGroups: strings(raw.topicGroups),
      isActive: raw.isActive,
      isFeatured: raw.isFeatured,
    };
  }
  if (kind === "course") {
    return {
      name: text(raw.name, 500),
      code: text(raw.code, 100),
      semester: text(raw.semester, 100),
      description: text(raw.description, 3_000),
      instructorName: text(raw.instructorName, 500),
      location: text(raw.location, 500),
      status: raw.status,
      startsOn: raw.startsOn,
      endsOn: raw.endsOn,
      customFields: raw.customFields,
      manualDeadlines: raw.manualDeadlines,
    };
  }
  return {
    emailId: String(raw.emailId ?? ""),
    category: raw.category,
    confidence: raw.confidence,
    summary: text(raw.summary, 2_000),
    matchedCourseId: raw.matchedCourseId
      ? String(raw.matchedCourseId)
      : undefined,
    matchedCourseName: text(raw.matchedCourseName, 500),
    suggestedTasks: raw.suggestedTasks,
    suggestedEvents: raw.suggestedEvents,
    userStatus: raw.userStatus,
    triagedAt: raw.triagedAt,
  };
}

function policyFor(
  kind: AgentDomainKind,
  raw: Record<string, unknown>,
): DomainPolicy {
  if (kind === "note" && raw.url) {
    return {
      sourceType: "note",
      entityType: "note",
      actor: "external",
      trust: "untrusted",
      sensitivity: "personal",
    };
  }
  if (kind === "calendar" && record(raw.source).provider) {
    return {
      sourceType: "calendar",
      entityType: "calendar",
      actor: "external",
      trust: "untrusted",
      sensitivity: "personal",
    };
  }
  if (kind === "email-triage") {
    return {
      sourceType: "email-triage",
      entityType: "email",
      actor: "external",
      trust: "untrusted",
      sensitivity: "sensitive",
    };
  }
  const sourceType = kind as Exclude<AgentDomainKind, "email-triage">;
  return {
    sourceType,
    entityType: kind,
    actor: "user",
    trust: "high",
    sensitivity: kind === "person" ? "sensitive" : "personal",
  };
}

function validDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function buildDomainEvidence(
  kind: AgentDomainKind,
  value: unknown,
): CreateAgentEvidenceEvent {
  const raw = record(value);
  const entityId = String(
    kind === "email-triage"
      ? (raw.emailId ?? raw._id ?? raw.id ?? "")
      : (raw._id ?? raw.id ?? ""),
  );
  if (!entityId) throw new Error(`Cannot observe ${kind} without an id`);
  const compact = compactRecord(kind, raw);
  const revision = stableContentHash(compact).slice(0, 32);
  const policy = policyFor(kind, raw);
  return buildEvidenceInput({
    idempotencyKey: `domain:${kind}:${entityId}:${revision}`,
    sourceType: policy.sourceType,
    sourceRef: {
      entityType: policy.entityType,
      entityId,
      revision,
    },
    sourceRevision: revision,
    content: compact,
    snapshot: JSON.stringify(compact),
    occurredAt:
      validDate(raw.updatedAt) ??
      validDate(raw.triagedAt) ??
      validDate(raw.date) ??
      new Date(),
    actor: policy.actor,
    trust: policy.trust,
    sensitivity: policy.sensitivity,
    provenance: { adapter: `domain-${kind}-v1` },
  });
}

export async function observeDomainRecordSafely(
  kind: AgentDomainKind,
  value: unknown,
): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await observeEvidence({
      memoryMode: "enabled",
      evidence: buildDomainEvidence(kind, value),
    });
  } catch (error) {
    console.warn("[agent-memory] Domain observation failed", {
      kind,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
