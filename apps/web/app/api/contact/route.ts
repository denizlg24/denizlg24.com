import { ipAddress } from "@vercel/functions";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createContact } from "@/lib/contacts";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendContactConfirmation } from "@/lib/resend";

const contactSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  message: z.string().min(10, "Message must be at least 10 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const _ipAddress = ipAddress(request) || "unknown";
    const { allowed, resetMs } = await checkRateLimit(`contact:${_ipAddress}`, {
      maxRequests: 5,
      windowMs: 3_600_000,
    });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) },
        },
      );
    }

    const validationResult = contactSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Please provide a valid name, email and message." },
        { status: 400 },
      );
    }

    const { name, email, message } = validationResult.data;

    const userAgent = request.headers.get("user-agent") || "unknown";

    const contact = await createContact({
      name,
      email,
      message,
      ipAddress: _ipAddress,
      userAgent,
    });

    const emailResult = await sendContactConfirmation({
      to: email,
      name,
      ticketId: contact.ticketId,
      message,
    });

    return NextResponse.json(
      {
        success: true,
        message: "Contact form submitted successfully",
        ticketId: contact.ticketId,
        emailSent: emailResult.success,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error submitting contact form:", error);
    return NextResponse.json(
      {
        error: "Failed to submit contact form",
      },
      { status: 500 },
    );
  }
}
