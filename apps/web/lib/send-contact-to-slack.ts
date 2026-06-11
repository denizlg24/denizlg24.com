"use server";

import { z } from "zod";

const contactFormSchema = z.object({
  name: z.string().min(2),
  email: z.email(),
  message: z.string().min(10),
});

type ContactFormData = z.infer<typeof contactFormSchema> & {
  ticketId?: string;
};

export async function sendToSlack(data: ContactFormData) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://denizlg24.com";

  if (!webhookUrl) {
    return { success: false, message: "Slack webhook URL is not configured" };
  }

  const parsed = contactFormSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, message: "Invalid form data" };
  }

  const timestamp = new Date().toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "New Contact Form Submission",
        emoji: true,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Received:* ${timestamp}${data.ticketId ? ` | *Ticket:* \`${data.ticketId}\`` : ""}`,
        },
      ],
    },
    {
      type: "divider",
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*From*\n${parsed.data.name}`,
        },
        {
          type: "mrkdwn",
          text: `*Email*\n<mailto:${parsed.data.email}|${parsed.data.email}>`,
        },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Message*\n>${parsed.data.message.split("\n").join("\n>")}`,
      },
    },
    {
      type: "divider",
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Reply via Email",
            emoji: true,
          },
          url: `mailto:${parsed.data.email}?subject=Re: Your message on denizgunes.com${data.ticketId ? ` [${data.ticketId}]` : ""}`,
          style: "primary",
        },
        ...(data.ticketId
          ? [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View in Admin",
                  emoji: true,
                },
                url: `${siteUrl}/admin/dashboard/contacts/${data.ticketId}`,
              },
            ]
          : []),
      ],
    },
  ];

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `New contact from ${parsed.data.name} (${parsed.data.email})`,
      blocks,
    }),
  });

  if (!response.ok) {
    return { success: false, message: "Failed to send message to Slack" };
  }

  return { success: true };
}
