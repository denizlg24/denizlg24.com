import type { ZodType } from "zod";
import { getAccessToken, NotSignedInError } from "./auth/session";
import { platformFetch } from "./platform";

const BASE_URL = process.env.NEXT_PUBLIC_DESKTOP_API_BASE_URL;

export interface AuthError {
  message: "Not signed in";
  code: 401;
}

export interface ApiError {
  message: string;
  code: number;
}

const AUTH_ERROR: AuthError = { message: "Not signed in", code: 401 };

type RequestInput = {
  method: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
};

/**
 * Bearer-authenticated client for the web app's admin API. Stateless: the
 * token comes from the OAuth session on every request, refreshed when it is
 * about to expire and once more if the server still refuses it — that second
 * refusal is a dead grant, which the session reports by signing out.
 */
export class denizApi {
  private async parseJson<T>(
    res: Response,
  ): Promise<{ data: T } | { error: ApiError }> {
    const text = await res.text();
    try {
      return { data: JSON.parse(text) as T };
    } catch {
      return {
        error: {
          message: `Non-JSON response (status ${res.status})`,
          code: res.status,
        },
      };
    }
  }

  private async errorFromResponse(res: Response): Promise<ApiError> {
    const fallback = `Request failed with HTTP ${res.status}`;

    try {
      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        const parsed = await this.parseJson<Record<string, unknown>>(res);
        if ("error" in parsed) {
          return { message: fallback, code: res.status };
        }
        const errorData = parsed.data;
        const message =
          typeof errorData.message === "string"
            ? errorData.message
            : typeof errorData.error === "string"
              ? errorData.error
              : typeof errorData.title === "string"
                ? errorData.title
                : fallback;
        return { message, code: res.status };
      }

      // A non-JSON body is almost always an error page from something in front
      // of the app — a proxy 502/503, a Next error document — not a message
      // written for a reader, so only a short plain-text body is quoted.
      const text = (await res.text()).trim();
      const quotable = text && !text.startsWith("<") && text.length <= 180;
      return {
        message: quotable ? `${fallback}: ${text}` : fallback,
        code: res.status,
      };
    } catch {
      return { message: fallback, code: res.status };
    }
  }

  private errorFromException(error: unknown): ApiError {
    return {
      message:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
      code: 500,
    };
  }

  private async send(
    endpoint: string,
    input: RequestInput,
    rejected?: string,
  ): Promise<Response> {
    const token = await getAccessToken({ rejected });
    const res = await platformFetch(`${BASE_URL}/${endpoint}`, {
      method: input.method,
      headers: { ...input.headers, authorization: `Bearer ${token}` },
      body: input.body,
      signal: input.signal,
    });
    if ((res.status === 401 || res.status === 403) && rejected === undefined) {
      return this.send(endpoint, input, token);
    }
    return res;
  }

  /** Resolves to the response on success, or the error the caller returns as-is. */
  private async request(
    endpoint: string,
    input: RequestInput,
  ): Promise<Response | AuthError | ApiError> {
    try {
      const res = await this.send(endpoint, input);
      if (res.ok) return res;
      return res.status === 401 || res.status === 403
        ? AUTH_ERROR
        : this.errorFromResponse(res);
    } catch (error) {
      return error instanceof NotSignedInError
        ? AUTH_ERROR
        : this.errorFromException(error);
    }
  }

  private async requestJson<T>(
    endpoint: string,
    input: RequestInput,
    schema?: ZodType<T>,
  ): Promise<T | AuthError | ApiError> {
    const res = await this.request(endpoint, input);
    if ("code" in res) return res;
    const parsed = await this.parseJson<T>(res);
    if ("error" in parsed) return parsed.error;
    if (!schema) return parsed.data;
    const result = schema.safeParse(parsed.data);
    if (!result.success) {
      return {
        message: `Response validation failed: ${result.error.issues[0]?.path.join(".")}`,
        code: 500,
      };
    }
    return result.data;
  }

  private json(method: string, body: unknown, signal?: AbortSignal) {
    return {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    };
  }

  public GET<T>({
    endpoint,
    schema,
  }: {
    endpoint: string;
    schema?: ZodType<T>;
  }): Promise<T | AuthError | ApiError> {
    return this.requestJson(endpoint, { method: "GET" }, schema);
  }

  public GET_RAW({
    endpoint,
  }: {
    endpoint: string;
  }): Promise<Response | AuthError | ApiError> {
    return this.request(endpoint, { method: "GET" });
  }

  public POST_STREAM({
    endpoint,
    body,
    signal,
  }: {
    endpoint: string;
    body: unknown;
    signal?: AbortSignal;
  }): Promise<Response | AuthError | ApiError> {
    return this.request(endpoint, this.json("POST", body, signal));
  }

  public POST<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: unknown;
  }): Promise<T | AuthError | ApiError> {
    return this.requestJson(endpoint, this.json("POST", body));
  }

  public PUT<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: unknown;
  }): Promise<T | AuthError | ApiError> {
    return this.requestJson(endpoint, this.json("PUT", body));
  }

  public PATCH<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: unknown;
  }): Promise<T | AuthError | ApiError> {
    return this.requestJson(endpoint, this.json("PATCH", body));
  }

  public UPLOAD<T>({
    endpoint,
    formData,
  }: {
    endpoint: string;
    formData: FormData;
  }): Promise<T | AuthError | ApiError> {
    return this.requestJson(endpoint, { method: "POST", body: formData });
  }

  public DELETE<T>({
    endpoint,
  }: {
    endpoint: string;
  }): Promise<T | AuthError | ApiError> {
    return this.requestJson(endpoint, { method: "DELETE" });
  }
}
