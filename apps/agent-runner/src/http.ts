/** `fetch` without Bun's `preconnect`, so a test can hand in a plain function. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export async function errorFrom(
  response: Response,
  what: string,
): Promise<HttpError> {
  const body = await response.text().catch(() => "");
  return new HttpError(
    `${what} failed (HTTP ${response.status}) ${body.slice(0, 300)}`,
    response.status,
    body,
  );
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
