export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface AuthMailer {
  send(email: AuthEmail): Promise<void>;
}

export class AuthMailUnavailableError extends Error {
  override readonly name = "AuthMailUnavailableError";
}

export function resendMailer(options: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}): AuthMailer {
  const send = options.fetch ?? fetch;
  return {
    async send(email) {
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          html: email.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new AuthMailUnavailableError(
          `Resend refused the message: HTTP ${response.status}`,
        );
      }
    },
  };
}

/** Development only: the link lands in the API log instead of an inbox. */
export function logMailer(): AuthMailer {
  return {
    async send(email) {
      console.info(
        `[auth mail] to ${email.to}: ${email.subject}\n${email.text}`,
      );
    },
  };
}

/** Production without a key: every send fails loudly instead of silently. */
export function unavailableMailer(): AuthMailer {
  return {
    async send() {
      throw new AuthMailUnavailableError("RESEND_API_KEY is not configured");
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs
    .map((line) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`)
    .join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#303630;color:#f9f8f6;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p><p style="margin:0 0 16px;color:#6b7068;font-size:13px">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f9f8f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#303630;font-size:15px;line-height:1.5"><div style="max-width:480px;margin:0 auto"><p style="margin:0 0 24px;font-weight:600">deniz <span style="font-weight:400">auth</span></p>${body}${button}</div></body></html>`;
}

function text(paragraphs: string[], action?: { label: string; url: string }) {
  return [
    ...paragraphs,
    ...(action ? [`${action.label}: ${action.url}`] : []),
  ].join("\n\n");
}

export function verificationEmail(input: {
  to: string;
  name: string;
  url: string;
}): AuthEmail {
  const paragraphs = [
    `Hi ${input.name},`,
    "Confirm this is your email address to finish setting up your deniz account.",
    "The link works for one hour. If you didn't create an account, you can ignore this email.",
  ];
  const action = { label: "Confirm email address", url: input.url };
  return {
    to: input.to,
    subject: "Confirm your email address",
    text: text(paragraphs, action),
    html: layout(paragraphs, action),
  };
}

export function passwordResetEmail(input: {
  to: string;
  name: string;
  url: string;
}): AuthEmail {
  const paragraphs = [
    `Hi ${input.name},`,
    "Someone asked to reset the password for your deniz account. If it was you, choose a new password with the link below.",
    "The link works for one hour. If you didn't ask for this, you can ignore this email — your password stays the same.",
  ];
  const action = { label: "Choose a new password", url: input.url };
  return {
    to: input.to,
    subject: "Reset your password",
    text: text(paragraphs, action),
    html: layout(paragraphs, action),
  };
}

export function existingAccountEmail(input: {
  to: string;
  signInUrl: string;
}): AuthEmail {
  const paragraphs = [
    "Someone tried to create a deniz account with this email address, but you already have one.",
    "If it was you, sign in instead. If you've forgotten your password, you can reset it from the sign-in page.",
    "If it wasn't you, you can ignore this email.",
  ];
  const action = { label: "Sign in", url: input.signInUrl };
  return {
    to: input.to,
    subject: "You already have a deniz account",
    text: text(paragraphs, action),
    html: layout(paragraphs, action),
  };
}
