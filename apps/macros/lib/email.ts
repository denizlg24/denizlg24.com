import { Resend } from "resend"

interface SendEmailInput {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail({ to, subject, html, text }: SendEmailInput) {
  const resendApiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM

  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is required to send auth emails.")
  }

  if (!from) {
    throw new Error("EMAIL_FROM is required to send auth emails.")
  }

  const resend = new Resend(resendApiKey)

  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  })

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`)
  }
}
