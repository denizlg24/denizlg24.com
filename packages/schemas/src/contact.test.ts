import { describe, expect, it } from "bun:test";
import { blogUpdateSchema } from "./blog";
import { contactSchema } from "./contact";

const validContact = {
  _id: "665f1c2e9b1d8a0012345678",
  ticketId: "TICKET-001",
  name: "Jane Doe",
  email: "jane@example.com",
  message: "Hello, I would like to get in touch.",
  ipAddress: "203.0.113.7",
  userAgent: "Mozilla/5.0",
  status: "pending",
  emailSent: false,
  createdAt: "2026-06-11T10:00:00.000Z",
  updatedAt: "2026-06-11T10:00:00.000Z",
};

describe("contactSchema", () => {
  it("parses a valid contact entity", () => {
    const result = contactSchema.safeParse(validContact);
    expect(result.success).toBe(true);
  });

  it("fails when a required field is missing", () => {
    const { ticketId: _ticketId, ...withoutTicketId } = validContact;
    const result = contactSchema.safeParse(withoutTicketId);
    expect(result.success).toBe(false);
  });

  it("fails on an invalid status enum value", () => {
    const result = contactSchema.safeParse({
      ...validContact,
      status: "snoozed",
    });
    expect(result.success).toBe(false);
  });
});

describe("blogUpdateSchema (plan 002 regression)", () => {
  it("accepts a whitelisted partial update", () => {
    const result = blogUpdateSchema.safeParse({
      title: "New title",
      isActive: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = blogUpdateSchema.safeParse({
      title: "New title",
      slug: "injected-slug",
    });
    expect(result.success).toBe(false);
  });
});
