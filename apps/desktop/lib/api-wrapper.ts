import { fetch } from "@tauri-apps/plugin-http";
import type { ZodType } from "zod";

const BASE_URL = process.env.NEXT_PUBLIC_DESKTOP_API_BASE_URL;

export interface AuthError {
  message: "API key is invalid";
  code: 401;
}

export interface ApiError {
  message: string;
  code: number;
}

export class denizApi {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

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

      const text = (await res.text()).trim();
      return {
        message: text ? `${fallback}: ${text.slice(0, 180)}` : fallback,
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

  public async GET<T>({
    endpoint,
    schema,
  }: {
    endpoint: string;
    schema?: ZodType<T>;
  }): Promise<T | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
        },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      const parsed = await this.parseJson<T>(res);
      if ("error" in parsed) {
        return parsed.error;
      }
      if (schema) {
        const result = schema.safeParse(parsed.data);
        if (!result.success) {
          return {
            message: `Response validation failed: ${result.error.issues[0]?.path.join(".")}`,
            code: 500,
          };
        }
        return result.data;
      }
      return parsed.data;
    } catch (error) {
      return this.errorFromException(error);
    }
  }

  public async GET_RAW({
    endpoint,
  }: {
    endpoint: string;
  }): Promise<Response | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
        },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      return res;
    } catch (error) {
      return this.errorFromException(error);
    }
  }

  public async POST_STREAM({
    endpoint,
    body,
    signal,
  }: {
    endpoint: string;
    body: unknown;
    signal?: AbortSignal;
  }): Promise<Response | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      return res;
    } catch (error) {
      return this.errorFromException(error);
    }
  }

  public async POST<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: unknown;
  }): Promise<T | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      const parsed = await this.parseJson<T>(res);
      if ("error" in parsed) {
        return parsed.error;
      }
      return parsed.data;
    } catch (error) {
      return this.errorFromException(error);
    }
  }

  public async PUT<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: unknown;
  }): Promise<T | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      const parsed = await this.parseJson<T>(res);
      if ("error" in parsed) {
        return parsed.error;
      }
      return parsed.data;
    } catch (error) {
      return this.errorFromException(error);
    }
  }

  public async PATCH<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: unknown;
  }): Promise<T | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      const parsed = await this.parseJson<T>(res);
      if ("error" in parsed) {
        return parsed.error;
      }
      return parsed.data;
    } catch (error) {
      return this.errorFromException(error);
    }
  }

  public async UPLOAD<T>({
    endpoint,
    formData,
  }: {
    endpoint: string;
    formData: FormData;
  }): Promise<T | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
        },
        body: formData,
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      const parsed = await this.parseJson<T>(res);
      if ("error" in parsed) {
        return parsed.error;
      }
      return parsed.data;
    } catch (error) {
      return this.errorFromException(error);
    }
  }

  public async DELETE<T>({
    endpoint,
  }: {
    endpoint: string;
  }): Promise<T | AuthError | ApiError> {
    try {
      const res = await fetch(`${BASE_URL}/${endpoint}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
        },
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { message: "API key is invalid", code: 401 };
        } else {
          return this.errorFromResponse(res);
        }
      }
      const parsed = await this.parseJson<T>(res);
      if ("error" in parsed) {
        return parsed.error;
      }
      return parsed.data;
    } catch (error) {
      return this.errorFromException(error);
    }
  }
}
