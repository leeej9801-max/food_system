import type { z } from "zod";
import type { ApiFieldError } from "../types";
import { problemSchema } from "./schemas";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8001/api/v1";

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

// 응답 본문은 schema로 검증한다. 단언(as)으로 믿지 않는다 (TS-010)
export async function apiRequest<T>(
  schema: z.ZodType<T>,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const problem = problemSchema.safeParse(body);
    if (problem.success) {
      const { code, detail, errors } = problem.data;
      throw new ApiClientError(response.status, code, detail, errors);
    }
    throw new ApiClientError(
      response.status,
      "HTTP_ERROR",
      `요청 처리 중 오류가 발생했습니다 (HTTP ${response.status}).`
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(`응답 형식 불일치: ${path}`, parsed.error.issues);
    throw new ApiClientError(
      response.status,
      "RESPONSE_SHAPE_ERROR",
      "서버 응답 형식이 예상과 다릅니다. 새로고침 후에도 반복되면 관리자에게 알려 주세요."
    );
  }
  return parsed.data;
}
