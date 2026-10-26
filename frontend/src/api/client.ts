import type { ApiErrorBody, ApiFieldError } from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8000/api/v1";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiFieldError[];

  constructor(status: number, code: string, message: string, details: ApiFieldError[] = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let parsed: ApiErrorBody | null = null;
    try {
      parsed = (await response.json()) as ApiErrorBody;
    } catch {
      parsed = null;
    }
    if (parsed?.error) {
      throw new ApiClientError(
        response.status,
        parsed.error.code,
        parsed.error.message,
        parsed.error.details ?? []
      );
    }
    throw new ApiClientError(
      response.status,
      "HTTP_ERROR",
      `요청 처리 중 오류가 발생했습니다 (HTTP ${response.status}).`
    );
  }

  return (await response.json()) as T;
}
