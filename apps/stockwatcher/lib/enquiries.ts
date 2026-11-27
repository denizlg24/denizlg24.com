import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { store } from "./db";
import { appUrl } from "./notify/channel-api";
import { deliver } from "./notify/send";

export const interests = [
  "Desk for a team",
  "Higher usage on my own",
  "Data or API access",
  "Something else",
] as const;

export const seatOptions = [
  "Just me",
  "2–5",
  "6–20",
  "21–100",
  "100+",
] as const;

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => value || null);

export const enquirySchema = z.object({
  name: z.string().trim().min(1, "Tell us your name.").max(120),
  email: z.email("Enter a valid email address.").max(200),
  company: optional(160),
  role: optional(120),
  seats: z
    .enum(seatOptions)
    .nullish()
    .transform((value) => value ?? null),
  interest: z.enum(interests),
  message: z
    .string()
    .trim()
    .min(10, "A sentence or two helps us reply with something useful.")
    .max(4000),
});

export type EnquiryInput = z.infer<typeof enquirySchema>;
export type Enquiry = EnquiryInput & { id: string; createdAt: string };

type Row = {
  id: string;
  name: string;
  email: string;
  company: string | null;
  role: string | null;
  seats: string | null;
  interest: string;
  message: string;
  created_at: string | Date;
};

const fromRow = (row: Row): Enquiry => ({
  id: String(row.id),
  name: row.name,
  email: row.email,
  company: row.company,
  role: row.role,
  seats: (row.seats as Enquiry["seats"]) ?? null,
  interest: row.interest as Enquiry["interest"],
  message: row.message,
  createdAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : String(row.created_at),
});

export async function saveEnquiry(input: EnquiryInput): Promise<Enquiry> {
  const enquiry: Enquiry = {
    ...input,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const db = await store();
  if (db.kind === "pg") {
    await db.sql`INSERT INTO stockwatcher_enquiries
      (id, name, email, company, role, seats, interest, message, created_at)
      VALUES (${enquiry.id}, ${enquiry.name}, ${enquiry.email}, ${enquiry.company},
        ${enquiry.role}, ${enquiry.seats}, ${enquiry.interest}, ${enquiry.message},
        ${enquiry.createdAt})`;
  } else {
    db.db
      .prepare(
        `INSERT INTO enquiries (id, name, email, company, role, seats, interest, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        enquiry.id,
        enquiry.name,
        enquiry.email,
        enquiry.company,
        enquiry.role,
        enquiry.seats,
        enquiry.interest,
        enquiry.message,
        enquiry.createdAt,
      );
  }
  return enquiry;
}

export async function listEnquiries(limit = 200): Promise<Enquiry[]> {
  const db = await store();
  const rows =
    db.kind === "pg"
      ? await db.sql<Row[]>`SELECT * FROM stockwatcher_enquiries
          ORDER BY created_at DESC LIMIT ${limit}`
      : (db.db
          .prepare("SELECT * FROM enquiries ORDER BY created_at DESC LIMIT ?")
          .all(limit) as Row[]);
  return rows.map(fromRow);
}

/** Emails the enquiry to `ENQUIRY_NOTIFY_EMAIL`; storage is the record, so a failed email is only logged. */
export async function notifyEnquiry(enquiry: Enquiry) {
  const address = process.env.ENQUIRY_NOTIFY_EMAIL;
  if (!address || !process.env.RESEND_API_KEY) return;
  try {
    await deliver(
      { kind: "email", address },
      {
        kicker: "Desk enquiry",
        title: `Stockwatcher enquiry: ${enquiry.interest}`,
        summary: `${enquiry.name} (${enquiry.email}) sent an enquiry about ${enquiry.interest}.`,
        tone: "info",
        time: enquiry.createdAt,
        url: appUrl("admin/enquiries"),
        action: "Open enquiries",
        triggers: [],
        details: (
          [
            ["Name", enquiry.name],
            ["Email", enquiry.email],
            ["Company", enquiry.company],
            ["Role", enquiry.role],
            ["Seats", enquiry.seats],
          ] as const
        ).flatMap(([label, value]) => (value ? [{ label, value }] : [])),
        body: enquiry.message,
        reason: "ENQUIRY_NOTIFY_EMAIL names this address for Desk enquiries.",
        manageUrl: null,
      },
    );
  } catch (error) {
    console.error("Stockwatcher could not email an enquiry", {
      id: enquiry.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
