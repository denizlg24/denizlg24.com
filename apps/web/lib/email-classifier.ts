import type { TriageCategory } from "@/models/EmailTriage";

const TRIAGE_CATEGORIES: TriageCategory[] = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
];

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

export interface EmailClassifierInput {
  subject: string;
  body: string;
  senderName: string;
  senderAddress: string;
  attachmentCount: number;
  hasHtml: boolean;
}

export interface EmailClassifierPrediction {
  category: TriageCategory;
  confidence: number;
  probabilities: Record<TriageCategory, number>;
  modelVersion: string;
}

export class EmailClassifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailClassifierError";
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function isTriageCategory(value: unknown): value is TriageCategory {
  return (
    typeof value === "string" &&
    TRIAGE_CATEGORIES.some((category) => category === value)
  );
}

function parseProbability(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined;
}

function parsePrediction(value: unknown): EmailClassifierPrediction {
  if (!isRecord(value) || !isTriageCategory(value.category)) {
    throw new EmailClassifierError("Classifier returned an invalid category");
  }

  const confidence = parseProbability(value.confidence);
  if (confidence === undefined) {
    throw new EmailClassifierError("Classifier returned invalid confidence");
  }
  if (!isRecord(value.probabilities)) {
    throw new EmailClassifierError("Classifier returned invalid probabilities");
  }

  const probabilities = {} as Record<TriageCategory, number>;
  for (const category of TRIAGE_CATEGORIES) {
    const probability = parseProbability(value.probabilities[category]);
    if (probability === undefined) {
      throw new EmailClassifierError(
        "Classifier returned an incomplete probability distribution",
      );
    }
    probabilities[category] = probability;
  }

  if (
    typeof value.model_version !== "string" ||
    value.model_version.trim().length === 0
  ) {
    throw new EmailClassifierError(
      "Classifier returned an invalid model version",
    );
  }

  return {
    category: value.category,
    confidence,
    probabilities,
    modelVersion: value.model_version,
  };
}

function getTimeoutMs(): number {
  const configured = Number(
    process.env.EMAIL_CLASSIFIER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
  );
  if (!Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(configured), 1_000), MAX_TIMEOUT_MS);
}

function getClassifierConfig(): { token: string; url: string } {
  const url = process.env.EMAIL_CLASSIFIER_URL?.trim();
  const token = process.env.EMAIL_CLASSIFIER_API_TOKEN?.trim();
  if (!url || !token) {
    throw new EmailClassifierError(
      "Email classifier URL and API token must be configured",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EmailClassifierError("Email classifier URL is invalid");
  }

  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localDevelopment) {
    throw new EmailClassifierError("Email classifier URL must use HTTPS");
  }

  return { token, url: parsed.toString() };
}

export async function classifyEmail(
  input: EmailClassifierInput,
): Promise<EmailClassifierPrediction> {
  const { token, url } = getClassifierConfig();

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: input.subject,
        body: input.body,
        sender_name: input.senderName,
        sender_address: input.senderAddress,
        attachment_count: input.attachmentCount,
        has_html: input.hasHtml,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(getTimeoutMs()),
    });
  } catch (error) {
    throw new EmailClassifierError(
      error instanceof DOMException && error.name === "TimeoutError"
        ? "Email classifier timed out"
        : "Email classifier request failed",
    );
  }

  if (!response.ok) {
    throw new EmailClassifierError(
      `Email classifier returned HTTP ${response.status}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new EmailClassifierError("Email classifier returned invalid JSON");
  }
  return parsePrediction(payload);
}
