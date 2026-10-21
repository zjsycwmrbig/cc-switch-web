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
  autoApprove?: AutoApprove;
}
export interface AutoApprove {
  enabled: boolean;
  maxUsers?: number | null;
  totalTokens?: number | null;
  perUserTokens?: number | null;
}
export const defaultPolicy = (): Policy => ({
  visibility: "private",
  period: "month",
  defaultBudget: {},
  sharedBudget: {},
  models: [],
  autoApprove: { enabled: false },
});
export interface ApplicationRow {
  id: string;
  resourceId: string;
  resourceName: string;
  counterpartyName: string;
  message: string;
  budget: Budget;
  models: string[];
  state: "pending" | "approved" | "rejected";
  decidedBy?: string | null;
  createdAt: number;
  decidedAt?: number | null;
  /** 申请时填写的期望截止时间，null 表示不限时间。 */
  requestedExpiresAt?: number | null;
  /** 批阅后实际生效的截止时间，null 表示不限时间。 */
  decidedExpiresAt?: number | null;
  /** 批阅后实际生效的模型清单。 */
  decidedModels?: string[];
  /** 批阅后实际生效的额度（请求次数 / Token）。 */
  decidedBudget?: Budget;
  /** approve / modify / reject / auto，用于在记录里区分同意、修改后同意与驳回。 */
  decisionKind?: string;
  /** 批阅说明（驳回原因或参数调整说明）。 */
  decisionNote?: string;
}

export interface UnitNotices {
  pendingApplications: number;
}
export interface Model {
  slug: string;
  display_name?: string;
  context_window?: number;
  description?: string;
}
export interface PersonalCodexCatalog {
  models: Model[];
  default_model?: string;
  warnings?: string[];
  user?: string;
  quotaUnit?: string;
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
  /** 本人有权使用的模型（授权与本人都能生效的部分）。 */
  models: Model[];
  /** 供应商对外可见、可被申请的模型（受分享设置限定）。 */
  visibleModels?: Model[];
  visibleModelCount?: number;
  policy?: Policy;
  accountId?: string;
  health: string;
  myBudget?: Budget;
  /** 共享给我的授权截止时间，null/未设置表示不限时间。 */
  myExpiresAt?: number | null;
  /** 额度来源：owner 自有 / grant 单独授权 / policy 公开默认额度。 */
  grantSource?: "owner" | "grant" | "policy";
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
