import { describe, expect, test } from "bun:test";
import type { IContact, NoteSummary } from "@repo/schemas";
import { contactItems, noteItems } from "./items";

describe("spotlight items", () => {
  test("a note carries its first line at most, never the body", () => {
    const note: NoteSummary = {
      _id: "n1",
      title: "Ideas",
      preview: "\nFirst line\nsecond line with secrets",
      updatedAt: "2026-10-16T10:00:00Z",
    };
    expect(noteItems([note])).toEqual([
      {
        id: "notes:n1",
        domain: "notes",
        title: "Ideas",
        description: "First line",
        url: "dashboard://more/note/n1",
      },
    ]);
  });

  test("contacts index the sender, not the message, and skip archived", () => {
    const contact = (
      ticketId: string,
      status: IContact["status"],
    ): IContact => ({
      _id: ticketId,
      ticketId,
      name: "Ana",
      email: "ana@x.dk",
      message: "private",
      ipAddress: "",
      userAgent: "",
      status,
      emailSent: false,
      createdAt: "",
      updatedAt: "",
    });
    const items = contactItems([
      contact("a", "read"),
      contact("b", "archived"),
    ]);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain("private");
  });
});
