export interface PiCronJob {
  id: string;
  name: string;
  expression: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  enabled: boolean;
  timeout: number;
  created_at: string;
  updated_at: string;
  last_status: number | null;
  last_run: string | null;
  last_error: string | null;
  next_run: string | null;
}

export interface PiCronHistoryEntry {
  id: string;
  job_id: string;
  status: number;
  duration_ms: number;
  response: string;
  error: string;
  started_at: string;
}

export interface PiCronStats {
  total_jobs: number;
  active_jobs: number;
  total_executions: number;
  failed_executions_24h: number;
}

export interface PiCronJobInput {
  name: string;
  expression: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  enabled?: boolean;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function acquireToken(
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `PiCron login failed (${res.status})`;
    try {
      msg = JSON.parse(text).error ?? msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }

  const { token } = JSON.parse(text) as { token: string };
  return token;
}

async function getToken(
  apiId: string,
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const cached = tokenCache.get(apiId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const token = await acquireToken(baseUrl, username, password);
  tokenCache.set(apiId, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
  return token;
}

export async function piCronFetch<T>(
  apiId: string,
  baseUrl: string,
  username: string,
  password: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const doRequest = (token: string) =>
    fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });

  let token = await getToken(apiId, baseUrl, username, password);
  let res = await doRequest(token);

  if (res.status === 401) {
    tokenCache.delete(apiId);
    token = await acquireToken(baseUrl, username, password);
    tokenCache.set(apiId, { token, expiresAt: Date.now() + 55 * 60 * 1000 });
    res = await doRequest(token);
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = `PiCron ${res.status}`;
    try {
      msg = JSON.parse(text).error ?? msg;
    } catch {
      /* noop */
    }
    throw new Error(msg);
  }

  if (!text.trim()) return {} as T;
  return JSON.parse(text) as T;
}
