import { fetch } from "@tauri-apps/plugin-http";

const BASE_URL =
  /*"http://localhost:3001/api/admin"*/ "https://denizlg24.com/api/admin";

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

  private async errorFromResponse(res: Response): Promise<ApiError> {
    const fallback = `Request failed with HTTP ${res.status}`;

    try {
      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        const errorData = await res.json();
        return {
          message:
            errorData.message ?? errorData.error ?? errorData.title ?? fallback,
          code: res.status,
        };
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

  public async GET<T>({
    endpoint,
  }: {
    endpoint: string;
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
      const data = await res.json();
      return data as T;
    } catch (error) {
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
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
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
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
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
    }
  }

  public async POST<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: any;
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
      const data = await res.json();
      return data as T;
    } catch (error) {
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
    }
  }

  public async PUT<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: any;
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
      const data = await res.json();
      return data as T;
    } catch (error) {
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
    }
  }

  public async PATCH<T>({
    endpoint,
    body,
  }: {
    endpoint: string;
    body: any;
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
      const data = await res.json();
      return data as T;
    } catch (error) {
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
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
      const data = await res.json();
      return data as T;
    } catch (error) {
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
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
      const data = await res.json();
      return data as T;
    } catch (error) {
      return {
        message: (error as Error).message ?? "An unexpected error occurred.",
        code: 500,
      };
    }
  }
}
