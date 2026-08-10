import { describe, expect, test } from "bun:test";
import {
  buildDomainEvidence,
  domainRecordIsMemoryEligible,
} from "./domain-evidence";

describe("domain record memory eligibility", () => {
  test("admits a triage row once a suggested task is accepted", () => {
    expect(
      domainRecordIsMemoryEligible("email-triage", {
        emailId: "email-1",
        category: "action-needed",
        suggestedTasks: [
          { title: "Renew the permit", status: "accepted" },
          { title: "Reply", status: "pending" },
        ],
        suggestedEvents: [],
      }),
    ).toBe(true);
  });

  test("admits a triage row once a suggested event is accepted", () => {
    expect(
      domainRecordIsMemoryEligible("email-triage", {
        emailId: "email-2",
        suggestedTasks: [],
        suggestedEvents: [{ title: "Viva", status: "accepted" }],
      }),
    ).toBe(true);
  });

  test("refuses a triage row nobody acted on, whatever its category", () => {
    for (const category of ["action-needed", "scheduled", "purchases", "fyi"]) {
      expect(
        domainRecordIsMemoryEligible("email-triage", {
          emailId: "email-3",
          category,
          confidence: 0.97,
          summary: "A very confident summary of somebody else's assertion.",
          suggestedTasks: [{ title: "Do the thing", status: "pending" }],
          suggestedEvents: [{ title: "Some date", status: "dismissed" }],
        }),
      ).toBe(false);
    }
  });

  test("refuses a triage row with no suggestions at all", () => {
    expect(
      domainRecordIsMemoryEligible("email-triage", { emailId: "email-4" }),
    ).toBe(false);
  });

  test("admits every other domain unconditionally", () => {
    for (const kind of [
      "note",
      "calendar",
      "person",
      "project",
      "course",
      "journal",
    ] as const) {
      expect(domainRecordIsMemoryEligible(kind, { _id: "x" })).toBe(true);
    }
  });
});

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
