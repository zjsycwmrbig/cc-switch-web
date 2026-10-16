import { getWebApiBase } from "@/lib/runtime/client/web";

export async function unit<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const csrf = sessionStorage.getItem("ccswitchuint-csrf");
  const response = await fetch(`${getWebApiBase()}/api/unit${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith("/auth/") &&
      sessionStorage.getItem("ccswitchuint-csrf") === csrf
    )
      window.dispatchEvent(new Event("ccswitchuint-unauthorized"));
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message || `请求失败 (${response.status})`,
    );
  }
  return data as T;
}
export interface Budget {
  requests?: number | null;
  tokens?: number | null;
  credits?: number | null;
}
export interface Usage {
  requests?: number;
  tokens?: number;
  credits?: number;
  reservedRequests?: number;
  reservedTokens?: number;
  reservedCredits?: number;
}
export interface Policy {
  visibility: string;
  period: string;
  defaultBudget: Budget;
  sharedBudget: Budget;
  models: string[];
  expiresAt?: number | null;
}
export const defaultPolicy = (): Policy => ({
  visibility: "public",
  period: "month",
  defaultBudget: {},
  sharedBudget: {},
  models: [],
});
export interface Model {
  slug: string;
  display_name?: string;
  context_window?: number;
  description?: string;
}
export interface Resource {
  id: string;
  name: string;
  appType: string;
  ownerId: string;
  ownerName: string;
  routeKey: string;
  owned: boolean;
  published: boolean;
  disabled: boolean;
  official: boolean;
  models: Model[];
  policy?: Policy;
  accountId?: string;
  health: string;
  myBudget?: Budget;
  cooldownUntil?: number;
}
export interface Me {
  user: { id: string; username: string; role: string; csrf: string };
  quota: {
    budget: Budget;
    period: string;
    periodKey: string;
    usage: {
      requests?: number;
      tokens?: number;
      credits?: number;
      reservedRequests?: number;
      reservedTokens?: number;
      reservedCredits?: number;
    };
  };
  publicUrl: string;
  proxyUrl: string;
}
export interface Preferences {
  models?: string[];
  startupModel?: string;
  [key: string]: unknown;
}
export interface Account {
  id: string;
  login: string;
  requires_reauth?: boolean;
  reauth_required?: boolean;
}
export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  active: number;
  created_at: number;
  last_used_at?: number;
  expires_at?: number;
}
export interface Aggregate {
  label?: string;
  requests: number;
  successful: number;
  pending: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_credits: number;
  unknown_cost: number;
  latency_ms: number;
}
export interface RequestRow {
  id: string;
  user_id: string;
  username: string;
  device: string;
  request_model: string;
  provider_name?: string;
  owner_name?: string;
  state: string;
  status: number;
  created_at: number;
  input_tokens: number;
  output_tokens: number;
  cost_credits?: number;
  error_code?: string;
}
export interface ShareCode {
  id: string;
  resourceId: string;
  resourceName: string;
  budget: Budget;
  models: string[];
  expiresAt?: number | null;
  maxClaims: number;
  claimedCount: number;
  active: boolean;
  createdAt: number;
  token?: string;
  url?: string;
}
export interface SupplierUsage {
  id: string;
  name: string;
  appType: string;
  ownerId: string;
  ownerName: string;
  owned: boolean;
  period: string;
  periodKey: string;
  budget: Budget;
  usage: Usage;
  remaining: Budget;
  balanceKind: "sharedPool" | "personalGrant";
  sharedBudget: Budget;
  sharedUsage: Usage;
}
export interface ProfileOverview {
  usage: {
    budget: Budget;
    period: string;
    periodKey: string;
    usage: Usage;
  };
  suppliers: SupplierUsage[];
}
export interface UserRow {
  id: string;
  username: string;
  role: string;
  active: number;
  budget: string;
  period: string;
  rpm: number;
  concurrency: number;
}
export function formatNumber(n = 0): string {
  return new Intl.NumberFormat("zh-CN").format(Math.round(n));
}
export function formatDate(n?: number): string {
  return n ? new Date(n * 1000).toLocaleString("zh-CN") : "—";
}
export function dollars(n?: number | null): string {
  return n == null ? "未知" : `$${(n / 1_000_000).toFixed(4)}`;
}
