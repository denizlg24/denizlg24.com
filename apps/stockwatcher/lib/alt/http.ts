import "server-only";
import { AltUnavailable } from "./types";

export const altUserAgent = () =>
  process.env.SEC_USER_AGENT ||
  "Stockwatcher research contact research@denizlg24.com";

type Options = {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
};

/**
 * Fetch from a public data publisher with an identifying User-Agent, a
 * timeout and a size cap. `label` names the publisher in the error a user sees.
 */
export async function altFetch(
  label: string,
  url: string,
  options: Options = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      body: options.body,
      headers: { "User-Agent": altUserAgent(), ...options.headers },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch (error) {
    throw new AltUnavailable(
      `${label} did not answer${error instanceof Error && error.name === "TimeoutError" ? " in time" : ""}.`,
    );
  }
  if (!response.ok)
    throw new AltUnavailable(
      `${label} returned HTTP ${response.status}.`,
      response.status === 404 ? 404 : 502,
      response.status >= 500 || response.status === 429,
    );
  const length = Number(response.headers.get("content-length"));
  if (options.maxBytes && length > options.maxBytes)
    throw new AltUnavailable(`${label} sent more data than expected.`);
  return response;
}

export async function altJson<T = unknown>(
  label: string,
  url: string,
  options: Options = {},
): Promise<T> {
  const response = await altFetch(label, url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });
  try {
    return (await response.json()) as T;
  } catch {
    throw new AltUnavailable(`${label} sent a response that is not JSON.`);
  }
}

export async function altText(
  label: string,
  url: string,
  options: Options = {},
): Promise<string> {
  return (await altFetch(label, url, options)).text();
}
