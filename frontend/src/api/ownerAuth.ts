import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiClientError, apiRequest } from "./client";

const ownerOAuthStartSchema = z.object({
  authorize_url: z.string().url(),
});

const ownerMeSchema = z.object({
  owner_id: z.string(),
  nickname: z.string().nullable(),
  stores: z.array(z.object({ id: z.string(), name: z.string() })),
});

export type OwnerOAuthStartResponse = z.infer<typeof ownerOAuthStartSchema>;
export type OwnerMe = z.infer<typeof ownerMeSchema>;

// 인가 URL(state + PKCE S256)은 백엔드가 만든다. state 쿠키는 HttpOnly라 credentials가 필요하다.
export function startOwnerKakaoLogin(): Promise<OwnerOAuthStartResponse> {
  return apiRequest(ownerOAuthStartSchema, "/auth/owner/kakao/start", { method: "GET" });
}

const isUnauthorized = (error: unknown) => error instanceof ApiClientError && error.status === 401;

// 로그인 안 됨 = null. access(15분) 만료 시 refresh 쿠키로 한 번 회전한 뒤 다시 조회한다.
export async function fetchOwnerMe(): Promise<OwnerMe | null> {
  try {
    return await apiRequest(ownerMeSchema, "/auth/owner/me");
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
  }
  try {
    await apiRequest(z.object({ refreshed: z.boolean() }), "/auth/owner/refresh", { method: "POST" });
  } catch (error) {
    if (isUnauthorized(error)) return null;
    throw error;
  }
  return apiRequest(ownerMeSchema, "/auth/owner/me");
}

export function useOwnerMe() {
  return useQuery({ queryKey: ["owner-me"], queryFn: fetchOwnerMe, retry: false, staleTime: 60_000 });
}
