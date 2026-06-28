import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAdminSession } from "@/lib/require-admin";
import {
  type SmtpAttachmentInput,
  type SmtpSendInput,
  sendMailFromAccount,
} from "@/lib/smtp";
import {
  EmailAccountModel,
  type ILeanEmailAccount,
} from "@/models/EmailAccount";

const MAX_RECIPIENTS = 50;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const sendSchema = z
  .object({
    to: z.array(z.email()).min(1),
    cc: z.array(z.email()).optional().default([]),
    bcc: z.array(z.email()).optional().default([]),
    subject: z.string().trim().max(300).default(""),
    text: z.string().min(1).max(100_000),
    html: z.string().max(200_000).optional(),
    replyToMessageId: z.string().trim().max(500).optional(),
  })
  .refine(
    (data) =>
      data.to.length + data.cc.length + data.bcc.length <= MAX_RECIPIENTS,
    {
      message: "Too many recipients",
      path: ["to"],
    },
  );

type ParseSendRequestResult =
  | { success: true; data: SmtpSendInput }
  | { success: false; error: string };

function splitRecipients(value: string) {
  return value
    .split(/[,\s;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRecipientField(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Fall back to a comma/space separated recipient field.
  }

  return splitRecipients(value);
}

function getStringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function isFilePart(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "name" in value &&
    typeof value.name === "string"
  );
}

function sanitizeAttachmentFilename(filename: string) {
  const sanitized = filename.replace(/[\\/\0\r\n]/g, "_").trim();
  return sanitized.slice(0, 180) || "attachment";
}

async function parseAttachments(
  formData: FormData,
): Promise<ParseSendRequestResult> {
  const files = formData
    .getAll("attachments")
    .filter((entry): entry is File => isFilePart(entry) && entry.size > 0);

  if (files.length > MAX_ATTACHMENTS) {
    return { success: false, error: "Too many attachments" };
  }

  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return { success: false, error: "Attachments are too large" };
  }

  const attachments: SmtpAttachmentInput[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return { success: false, error: "Attachment is too large" };
    }

    attachments.push({
      filename: sanitizeAttachmentFilename(file.name),
      content: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || undefined,
    });
  }

  return {
    success: true,
    data: {
      to: [],
      subject: "",
      text: "",
      attachments,
    },
  };
}

async function parseSendRequest(
  request: NextRequest,
): Promise<ParseSendRequestResult> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    const parsed = sendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return { success: false, error: "Invalid email send request" };
    }
    return { success: true, data: parsed.data };
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return { success: false, error: "Invalid email send request" };
  }

  const attachmentsResult = await parseAttachments(formData);
  if (!attachmentsResult.success) return attachmentsResult;

  const parsed = sendSchema.safeParse({
    to: parseRecipientField(formData.get("to")),
    cc: parseRecipientField(formData.get("cc")),
    bcc: parseRecipientField(formData.get("bcc")),
    subject: getStringField(formData, "subject") ?? "",
    text: getStringField(formData, "text") ?? "",
    html: getStringField(formData, "html"),
    replyToMessageId: getStringField(formData, "replyToMessageId"),
  });

  if (!parsed.success) {
    return { success: false, error: "Invalid email send request" };
  }

  return {
    success: true,
    data: {
      ...parsed.data,
      attachments: attachmentsResult.data.attachments,
    },
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimitKey = `email-send:${session.user.email ?? "admin"}`;
  const rateLimit = await checkRateLimit(rateLimitKey, {
    maxRequests: 20,
    windowMs: 60_000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many send attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateLimit.resetMs / 1000)) },
      },
    );
  }

  const parsed = await parseSendRequest(request);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const { id } = await params;
    await connectDB();
    const account = await EmailAccountModel.findById(
      id,
    ).lean<ILeanEmailAccount | null>();

    if (!account) {
      return NextResponse.json(
        { error: "Email account not found" },
        { status: 404 },
      );
    }

    await sendMailFromAccount(account, parsed.data);
    console.log("Email sent", {
      accountId: id,
      provider: account.provider ?? "custom",
      recipientCount:
        parsed.data.to.length +
        (parsed.data.cc?.length ?? 0) +
        (parsed.data.bcc?.length ?? 0),
      success: true,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "SMTP is not configured for this account"
    ) {
      return NextResponse.json(
        { error: "SMTP sending is not configured for this account" },
        { status: 400 },
      );
    }

    console.error("Email send failed", { success: false });
    return NextResponse.json(
      { error: "Failed to send email. Check the account SMTP settings." },
      { status: 502 },
    );
  }
}
