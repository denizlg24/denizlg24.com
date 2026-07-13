import { describe, expect, test } from "bun:test";
import { buildDomainEvidence } from "./domain-evidence";

describe("agent memory domain evidence adapters", () => {
  test("treats manual people records as trusted sensitive evidence", () => {
    const evidence = buildDomainEvidence("person", {
      _id: "person-1",
      name: "Ada",
      notes: "Met through systems work",
      updatedAt: "2026-07-13T12:00:00.000Z",
    });
    expect(evidence).toMatchObject({
      sourceType: "person",
      actor: "user",
      trust: "high",
      sensitivity: "sensitive",
      sourceRef: { entityType: "person", entityId: "person-1" },
    });
  });

  test("keeps imported notes and triage summaries untrusted and bounded", () => {
    const note = buildDomainEvidence("note", {
      _id: "note-1",
      title: "Imported",
      url: "https://example.com",
      content: "x".repeat(20_000),
    });
    const triage = buildDomainEvidence("email-triage", {
      _id: "triage-1",
      emailId: "email-1",
      summary: "A bounded external summary",
    });
    expect(note.trust).toBe("untrusted");
    expect(note.snapshot?.length).toBeLessThan(8_192);
    expect(triage).toMatchObject({
      sourceType: "email-triage",
      actor: "external",
      trust: "untrusted",
      sensitivity: "sensitive",
    });
  });

  test("uses content-derived revisions for idempotent re-observation", () => {
    const first = buildDomainEvidence("project", {
      _id: "project-1",
      title: "Agent",
      markdown: "Version one",
    });
    const duplicate = buildDomainEvidence("project", {
      _id: "project-1",
      title: "Agent",
      markdown: "Version one",
    });
    const changed = buildDomainEvidence("project", {
      _id: "project-1",
      title: "Agent",
      markdown: "Version two",
    });
    expect(first.idempotencyKey).toBe(duplicate.idempotencyKey);
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  test("captures journal text without copying whiteboard content", () => {
    const evidence = buildDomainEvidence("journal", {
      _id: "journal-1",
      date: "2026-07-13T00:00:00.000Z",
      content: "Finished the retrieval milestone.",
      whiteboard: { _id: "board-1", elements: ["large", "payload"] },
    });
    expect(evidence).toMatchObject({
      sourceType: "journal",
      trust: "high",
      sourceRef: { entityType: "journal", entityId: "journal-1" },
    });
    expect(evidence.snapshot).not.toContain("large");
  });
});
