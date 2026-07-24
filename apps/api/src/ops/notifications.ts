export interface NotificationPayload {
  event: "alert" | "task_failure";
  title: string;
  message: string;
  taskId?: string;
  runId?: string;
  runUrl?: string;
}

export class WebhookNotifier {
  constructor(
    private readonly webhookUrl: string | undefined,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return Boolean(this.webhookUrl);
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.webhookUrl) return false;
    const response = await this.fetchImplementation(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        text: `${payload.title}\n${payload.message}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Notification webhook returned HTTP ${response.status}`);
    }
    return true;
  }
}
