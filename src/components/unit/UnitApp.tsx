import { copyText } from "@/lib/clipboard";
import { setWebUserRole } from "@/lib/runtime/client/web";
import {
  FormEvent,
  ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  ChevronDown,
  Copy,
  History,
  KeyRound,
  Link2,
  LoaderCircle,
  Plus,
  Route,
  Search,
  Trash2,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AggregationSyncPanel } from "@/components/providers/AggregationSyncPanel";
import {
  unit,
  Budget,
  ApplicationRow,
  Usage as UsageNumbers,
  Policy,
  defaultPolicy,
  Resource,
  Me,
  Preferences,
  ApiKey,
  Aggregate,
  RequestRow,
  ProfileOverview,
  ShareCode,
  UserRow,
  formatNumber as num,
  formatDate as date,
  dollars,
} from "./client";
import "./unit.css";
import { LimitField } from "./LimitField";
import {
  clearFilteredRoutes,
  collapseSelectedRoutes,
  modelGroupKey,
  routeSlug,
  selectFilteredRoutes,
  usableRouteTargets,
} from "./modelSelection";
import { UnitSession, useUnitSession } from "./session";

const SwitchApp = lazy(() => import("@/App"));
const messages: Record<string, string> = {
  completed: "完成",
  failed: "失败",
  pending_usage: "待核算",
  reserved: "进行中",
  ready: "可用",
  unknown: "待检查",
  reauth_required: "需要重新登录",
  removed: "账号已移除",
  upstream_rate_or_quota_limit: "限流或额度耗尽",
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败";
const copy = async (text: string) => {
  try {
    await copyText(text);
    toast.success("已复制");
  } catch {
    toast.error("浏览器未允许复制，请选中文本复制");
  }
};
function Empty({ children }: { children: ReactNode }) {
  return <div className="u-empty">{children}</div>;
}
function Busy() {
  return <LoaderCircle className="h-5 w-5 animate-spin" aria-label="加载中" />;
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="unit-modal max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="u-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function BudgetFields({
  value,
  change,
  title,
  hideCredits,
}: {
  value: Budget;
  change: (b: Budget) => void;
  title: string;
  /** 申请/授权只按「请求次数 + Token + 截止时间 + 模型范围」四个条件，隐藏点数。 */
  hideCredits?: boolean;
}) {
  const fields = (
    [
      ["requests", "请求次数"],
      ["tokens", "Token 数量（支持 K / M）"],
      ["credits", "点数"],
    ] as const
  ).filter(([key]) => !(hideCredits && key === "credits"));
  return (
    <fieldset className="u-budget">
      <legend>{title}</legend>
      <div className="u-budget-grid">
        {fields.map(([key, label]) => (
          <Field key={key} label={label}>
            {key === "tokens" ? (
              <LimitField
                kind="tokens"
                value={value.tokens}
                change={(tokens) => change({ ...value, tokens })}
              />
            ) : key === "requests" ? (
              <LimitField
                kind="requests"
                value={value.requests}
                change={(requests) => change({ ...value, requests })}
              />
            ) : (
              <input
                type="number"
                min={0}
                step={1}
                placeholder="不限"
                value={value[key] ?? ""}
                onChange={(e) =>
                  change({
                    ...value,
                    [key]:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            )}
          </Field>
        ))}
      </div>
      <small>
        留空表示不限，0 表示没有额度。
        {hideCredits ? "" : " 1,000,000 点对应 $1 估算成本。"}
      </small>
    </fieldset>
  );
}
function parseBudget(value: unknown): Budget {
  if (typeof value === "string") {
    try {
      return parseBudget(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const read = (key: string) =>
    typeof row[key] === "number" ? (row[key] as number) : null;
  return {
    requests: read("requests"),
    tokens: read("tokens"),
    credits: read("credits"),
  };
}
function parseModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => !!v);
  if (typeof value !== "string") return [];
  try {
    return parseModels(JSON.parse(value));
  } catch {
    return [];
  }
}
function compactTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}G`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return String(value);
}
function budgetText(value: Budget): string {
  return (
    [
      value.requests == null ? null : `${num(value.requests)} 次`,
      value.tokens == null ? null : `${num(value.tokens)} Token`,
      value.credits == null ? null : `${num(value.credits)} 点`,
    ]
      .filter(Boolean)
      .join(" / ") || "不限"
  );
}

/** 时间截止的展示：空值统一按“不限时间”处理。 */
function deadlineText(value?: number | null): string {
  return value ? date(value) : "不限时间";
}

const pad2 = (value: number) => String(value).padStart(2, "0");

/** unix 秒 -> datetime-local 需要的时间字符串。 */
function deadlineToInput(value?: number | null): string {
  if (!value) return "";
  const at = new Date(value * 1000);
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}T${pad2(
    at.getHours(),
  )}:${pad2(at.getMinutes())}`;
}

function inputToDeadline(value?: string): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? Math.floor(at / 1000) : null;
}

/** 额度来源文案：让用户知道额度来自单独授权还是供应商的公开默认值。 */
function grantSourceText(source?: "owner" | "grant" | "policy"): string {
  if (source === "owner") return "自有";
  if (source === "policy") return "公开默认额度";
  return "单独授权";
}

/** 申请记录里的处理结论文案。 */
function decisionLabel(application: ApplicationRow): string {
  if (application.state === "pending") return "待审批";
  if (application.state === "rejected") return "已驳回";
  if (application.decidedBy === "auto" || application.decisionKind === "auto")
    return "免审通过";
  return application.decisionKind === "modify" ? "修改后同意" : "同意";
}
function remainingBudget(budget: Budget, usage: UsageNumbers): Budget {
  const left = (
    limit: number | null | undefined,
    used: number | undefined,
    held: number | undefined,
  ) => (limit == null ? null : Math.max(0, limit - (used || 0) - (held || 0)));
  return {
    requests: left(budget.requests, usage.requests, usage.reservedRequests),
    tokens: left(budget.tokens, usage.tokens, usage.reservedTokens),
    credits: left(budget.credits, usage.credits, usage.reservedCredits),
  };
}
function usageText(value: unknown): string {
  return num(Number(value || 0));
}
const periodName = (period: string) =>
  period === "day" ? "每日" : period === "lifetime" ? "累计" : "每月";

export default function UnitApp() {
  const query = useQueryClient();
  const claimAttempted = useRef(false);
  const [me, setMe] = useState<Me | null>(null),
    [checking, setChecking] = useState(true);
  const [unavailable, setUnavailable] = useState("");
  const refreshMe = useCallback(async () => {
    const value = await unit<Me>("/me");
    sessionStorage.setItem("ccswitchuint-csrf", value.user.csrf);
    localStorage.removeItem("cc-switch-web-access-key");
    setWebUserRole(value.user.role);
    setMe(value);
  }, []);
  const reset = useCallback(() => {
    setWebUserRole(null);
    setMe(null);
    sessionStorage.removeItem("ccswitchuint-usage-scope");
    sessionStorage.removeItem("ccswitchuint-csrf");
    query.clear();
  }, [query]);
  useEffect(() => {
    let live = true;
    void refreshMe()
      .catch((error) => {
        if (!String(errorText(error)).includes("登录"))
          setUnavailable(errorText(error));
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    const expired = () => reset();
    window.addEventListener("ccswitchuint-unauthorized", expired);
    return () => {
      live = false;
      window.removeEventListener("ccswitchuint-unauthorized", expired);
    };
  }, [refreshMe, reset]);
  useEffect(() => {
    if (!me || claimAttempted.current) return;
    const claim = new URLSearchParams(window.location.search).get("claim");
    if (!claim) return;
    claimAttempted.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("claim");
    window.history.replaceState(
      {},
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
    void unit<{ resourceName: string }>("/share-claims", "POST", {
      token: claim,
    })
      .then(async (result) => {
        toast.success(`已领取 ${result.resourceName} 的共享额度`);
        await refreshMe();
        await Promise.all([
          query.invalidateQueries({ queryKey: ["providers"] }),
          query.invalidateQueries({ queryKey: ["unit", "profile"] }),
        ]);
      })
      .catch((error) => toast.error(errorText(error)));
  }, [me, query, refreshMe]);
  const logout = async () => {
    try {
      await unit("/auth/logout", "POST");
      reset();
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  if (checking)
    return (
      <main className="u-loading">
        <Busy />
      </main>
    );
  if (!me)
    return (
      <SignIn
        error={unavailable}
        signedIn={async () => {
          query.clear();
          setUnavailable("");
          await refreshMe();
        }}
      />
    );
  return (
    <UnitSession.Provider value={{ me, refresh: refreshMe, logout, reset }}>
      <Suspense fallback={<Busy />}>
        <SwitchApp />
      </Suspense>
    </UnitSession.Provider>
  );
}

/** New multi-user controls live inside the existing CC Switch shell. */
export function UnitPanel({
  page,
}: {
  page: "models" | "allocations" | "profile" | "admin";
}) {
  const session = useUnitSession();
  const [generation, setGeneration] = useState(0);
  if (!session) return null;
  const { me, reset } = session;
  const refresh = () => {
    setGeneration((n) => n + 1);
    void session.refresh();
  };
  return (
    <div className="unit-content w-full px-3 py-4 md:px-6">
      {/* 统一给单元页的顶层区块留出间距，避免卡片/面板贴在一起。 */}
      <div className="flex flex-col gap-5">
        {page === "models" && <Models me={me} generation={generation} />}
        {page === "allocations" && <Allocations generation={generation} />}
        {page === "profile" && (
          <Profile me={me} generation={generation} loggedOut={reset} />
        )}
        {page === "admin" && me.user.role === "admin" && (
          <Admin generation={generation} refresh={refresh} />
        )}
      </div>
    </div>
  );
}

function SignIn({
  signedIn,
  error,
}: {
  signedIn: () => Promise<void>;
  error: string;
}) {
  const [register, setRegister] = useState(false),
    [open, setOpen] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(error);
  useEffect(() => {
    void unit<{ registrationOpen: boolean }>("/auth/status")
      .then((v) => setOpen(v.registrationOpen))
      .catch((e) => setMessage(errorText(e)));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await unit(`/auth/${register ? "register" : "login"}`, "POST", {
        username,
        password,
      });
      await signedIn();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="unit-app u-login">
      <section className="u-login-card">
        <div className="u-brand">
          <Boxes size={30} />
          <span>
            ccSwitch<span className="u-brand-accent">Uint</span>
          </span>
        </div>
        <h1>{register ? "创建你的账号" : "登录工作空间"}</h1>
        <p>选择可用模型，管理自己的资源与额度。</p>
        <form onSubmit={submit}>
          <Field label="用户名">
            <input
              required
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="字母、数字、下划线或连字符"
            />
          </Field>
          <Field label="密码">
            <input
              type="password"
              required
              minLength={8}
              maxLength={256}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {message && (
            <p className="u-error" role="alert">
              {message}
            </p>
          )}
          <button className="u-button" disabled={busy}>
            {busy ? <Busy /> : register ? "注册并进入" : "登录"}
          </button>
        </form>
        {open && (
          <button
            className="u-quiet"
            onClick={() => {
              setRegister((v) => !v);
              setMessage("");
            }}
          >
            {register ? "已有账号？登录" : "还没有账号？注册"}
          </button>
        )}
      </section>
    </main>
  );
}
function routeIsAuto(route: ModelRoute) {
  return route.auto;
}

function Models({ generation }: { me: Me; generation: number }) {
  const [prefs, setPrefs] = useState<Preferences>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [providerFilter, setProviderFilter] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [routeKinds, setRouteKinds] = useState<Set<"direct" | "auto">>(
    new Set(["direct"]),
  );
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detectBusy, setDetectBusy] = useState(false);
  const [detectAllModels, setDetectAllModels] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [catalogRevision, setCatalogRevision] = useState(0);

  const load = useCallback(async () => {
    // 先取映射（首次会由服务端初始化），再按映射生成目录。
    const routeRows = await unit<ModelRoute[]>("/model-routes");
    const [p, resourceRows] = await Promise.all([
      unit<Preferences>("/preferences"),
      unit<Resource[]>("/resources"),
    ]);
    const allowed = resourceRows.filter(
      (resource) =>
        resource.appType === "codex" &&
        !resource.disabled &&
        (resource.published || resource.owned),
    );
    setRoutes(routeRows);
    setResources(allowed);
    setPrefs(p);
    setSelected(
      collapseSelectedRoutes(
        routeRows,
        allowed,
        new Set(
          p.models ?? routeRows.map((route) => routeSlug(route, allowed)),
        ),
      ),
    );
  }, []);

  useEffect(() => {
    let live = true;
    setBusy(true);
    void load()
      .catch((error) => toast.error(errorText(error)))
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [generation, load]);

  useEffect(() => {
    setPage(1);
  }, [search, providerFilter, modelFilter]);

  // 供应商目录/共享范围可能被其他用户随时调整：定时与窗口聚焦时刷新，
  // 服务端会顺手清掉已失效的路由目标。
  useEffect(() => {
    const refresh = () => {
      void load().catch(() => {});
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const persistSelection = async (
    selection: Set<string>,
    successMessage: string,
  ) => {
    setSaving(true);
    try {
      const ids = [
        ...collapseSelectedRoutes(routes, resources, selection),
      ].filter((id) =>
        routes.some((route) => routeSlug(route, resources) === id),
      );
      const next = {
        ...prefs,
        models: ids,
        startupModel: ids.includes(prefs.startupModel || "")
          ? prefs.startupModel
          : ids[0],
      };
      await unit("/preferences", "PUT", next);
      setPrefs(next);
      setSelected(new Set(ids));
      setCatalogRevision((value) => value + 1);
      toast.success(successMessage);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  const save = () =>
    persistSelection(
      selected,
      "已保存路由与同步展示；实际请求仍按映射路由处理",
    );
  const addRouteToSync = (route: ModelRoute) => {
    const next = new Set(selected);
    next.add(routeSlug(route, resources));
    return persistSelection(
      collapseSelectedRoutes(routes, resources, next),
      `已将“${route.displayName}”加入 Codex 同步展示`,
    );
  };

  const persist = async (route: ModelRoute) => {
    await unit("/model-routes", "POST", {
      id: route.id,
      displayName: route.displayName,
      model: route.model,
      targets: route.targets,
      auto: route.auto,
    });
    setRoutes(await unit<ModelRoute[]>("/model-routes"));
    setCatalogRevision((value) => value + 1);
  };

  const moveTarget = async (route: ModelRoute, from: number, to: number) => {
    if (from === to || to < 0 || to >= route.targets.length) return;
    const targets = [...route.targets];
    const [item] = targets.splice(from, 1);
    targets.splice(to, 0, item);
    try {
      await persist({ ...route, targets });
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const detect = async () => {
    setDetectBusy(true);
    try {
      const result = await unit<{ candidates: unknown[] }>(
        "/model-routes/detect",
        "POST",
        { apply: true, includeAllModels: detectAllModels },
      );
      await load();
      setCatalogRevision((value) => value + 1);
      const autoCount = (await unit<ModelRoute[]>("/model-routes")).filter(
        routeIsAuto,
      ).length;
      toast.success(
        `按${detectAllModels ? "全平台" : "我的可用"}模型识别：变更 ${result.candidates.length} 组；当前共 ${autoCount} 组自动路由`,
      );
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setDetectBusy(false);
    }
  };

  const providerLabel = (route: ModelRoute, id: string) => {
    const detail = route.targetDetails?.find((item) => item.id === id);
    if (detail) {
      return detail.ownerName
        ? `${detail.ownerName} 的 ${detail.name}`
        : detail.name;
    }
    const resource = resources.find((item) => item.id === id);
    return resource ? `${resource.ownerName} 的 ${resource.name}` : id;
  };
  const routeAvailability = (route: ModelRoute) => {
    const total = route.targets.length;
    const available = usableRouteTargets(route).length;
    return { available, total, partial: available > 0 && available < total };
  };

  const filtered = routes.filter((route) => {
    if (routeKinds.size > 0) {
      const kind = routeIsAuto(route) ? "auto" : "direct";
      if (!routeKinds.has(kind)) return false;
    }
    const keyword = search.trim().toLowerCase();
    const usableTargetIds = usableRouteTargets(route).map((item) => item.id);
    const text =
      `${route.displayName} ${route.model} ${usableTargetIds.map((id) => providerLabel(route, id)).join(" ")}`.toLowerCase();
    return (
      (!keyword || text.includes(keyword)) &&
      (!providerFilter || usableTargetIds.includes(providerFilter)) &&
      (!modelFilter || route.model === modelFilter)
    );
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / 10));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * 10, current * 10);
  const modelOptions = [...new Set(routes.map((route) => route.model))].sort();

  return (
    <>
      <div className="u-page-lead">
        <p>
          请求路由始终按映射处理；勾选与加入同步只决定 Codex
          模型菜单中显示哪些模型。
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[
          [
            "1",
            "配置映射",
            "点“映射”调整供应商目标与顺序；可用之后会立即参与请求路由。",
          ],
          [
            "2",
            "加入同步展示",
            "可单条加入，也可勾选后批量加入；这里只控制 Codex 中显示哪些模型。",
          ],
          [
            "3",
            "复制命令到主机",
            "在“同步聚合模型”里复制命令，到目标机器执行即可完成接入。",
          ],
        ].map(([step, title, description]) => (
          <div
            key={step}
            className="rounded-lg border border-border bg-card/60 p-3"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-xs text-primary">
                {step}
              </span>
              {title}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>
        ))}
      </div>
      <AggregationSyncPanel
        refreshKey={catalogRevision}
        onPreferencesSaved={(next) => {
          setPrefs(next);
          setSelected(new Set(next.models ?? []));
        }}
      />
      <div className="u-panel">
        <div className="u-panel-title">
          <Route size={17} />
          模型与路由
          <small>
            同步展示 {selected.size} / {routes.length} 条
          </small>
          <span className="u-spacer" />
          <button
            className="u-button"
            type="button"
            disabled={saving || busy}
            onClick={() => void save()}
          >
            {saving ? <Busy /> : "保存路由"}
          </button>
        </div>
        <div className="u-panel-body">
          <div className="u-toolbar">
            <div className="u-search">
              <Search size={15} />
              <input
                placeholder="搜索名称、模型或供应商"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
            >
              <option value="">所有供应商</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.ownerName} 的 {resource.name}
                </option>
              ))}
            </select>
            <select
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
            >
              <option value="">所有模型</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <div
              className="u-route-kinds"
              role="group"
              aria-label="路由类型筛选"
            >
              {(
                [
                  ["auto", "路由"],
                  ["direct", "直连"],
                ] as const
              ).map(([kind, label]) => {
                const active = routeKinds.has(kind);
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={active}
                    className={active ? "active" : ""}
                    onClick={() =>
                      setRouteKinds((current) => {
                        const next = new Set(current);
                        if (next.has(kind)) next.delete(kind);
                        else next.add(kind);
                        return next;
                      })
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="u-inline">
              <span>识别范围</span>
              <div
                className="u-route-kinds"
                role="group"
                aria-label="自动识别范围"
              >
                <button
                  type="button"
                  aria-pressed={!detectAllModels}
                  className={!detectAllModels ? "active" : ""}
                  onClick={() => setDetectAllModels(false)}
                >
                  我的可用
                </button>
                <button
                  type="button"
                  aria-pressed={detectAllModels}
                  className={detectAllModels ? "active" : ""}
                  onClick={() => setDetectAllModels(true)}
                >
                  全平台
                </button>
              </div>
            </div>
            <button
              className="u-quiet"
              type="button"
              disabled={detectBusy}
              onClick={() => void detect()}
            >
              {detectBusy ? "识别中…" : "自动识别映射"}
            </button>
            <button
              className="u-quiet"
              type="button"
              onClick={() =>
                void load()
                  .then(() => toast.success("已刷新可选模型"))
                  .catch((error) => toast.error(errorText(error)))
              }
            >
              刷新
            </button>
            <button
              className="u-quiet"
              type="button"
              onClick={() =>
                setSelected((current) =>
                  selectFilteredRoutes(routes, filtered, resources, current),
                )
              }
            >
              全选
            </button>
            <button
              className="u-quiet"
              type="button"
              onClick={() =>
                setSelected((current) =>
                  clearFilteredRoutes(filtered, resources, current),
                )
              }
            >
              清空
            </button>
            <button
              className="u-quiet"
              type="button"
              disabled={saving || !selected.size}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : `批量加入同步 (${selected.size})`}
            </button>
            <label className="u-inline">
              启动模型
              <select
                value={prefs.startupModel || ""}
                onChange={(event) =>
                  setPrefs({ ...prefs, startupModel: event.target.value })
                }
              >
                <option value="">第一个已选模型</option>
                {routes
                  .filter((route) => selected.has(routeSlug(route, resources)))
                  .map((route) => (
                    <option key={route.id} value={routeSlug(route, resources)}>
                      {route.displayName}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <p className="u-note" style={{ margin: "10px 0 14px" }}>
            供应商映射与顺序会立即参与所有 ccs 请求路由；同步展示选择只影响
            Codex 模型列表。
          </p>
          {busy ? (
            <Empty>
              <Busy />
            </Empty>
          ) : visible.length ? (
            <div className="u-model-list">
              {visible.map((route) => {
                const slug = routeSlug(route, resources);
                const open = expanded === route.id;
                const availability = routeAvailability(route);
                const targetEntries = usableRouteTargets(route);
                return (
                  <div
                    className={`u-model ${
                      routeIsAuto(route) ? "u-model-auto" : "u-model-single"
                    } ${
                      availability.available === 0
                        ? "u-model-unavailable"
                        : availability.partial
                          ? "u-model-partial"
                          : ""
                    }`}
                    key={route.id}
                    style={{ alignItems: "flex-start" }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择 ${route.displayName} 加入同步展示`}
                      checked={selected.has(slug)}
                      onChange={() =>
                        setSelected((old) => {
                          const next = new Set(old);
                          if (next.has(slug)) {
                            next.delete(slug);
                          } else {
                            next.add(slug);
                            const group = modelGroupKey(route.model);
                            for (const other of routes) {
                              if (
                                other.auto !== route.auto &&
                                modelGroupKey(other.model) === group
                              ) {
                                next.delete(routeSlug(other, resources));
                              }
                            }
                          }
                          return next;
                        })
                      }
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          key={`${route.id}-${route.displayName}`}
                          defaultValue={route.displayName}
                          aria-label="显示名称"
                          onBlur={(event) => {
                            const name = event.target.value.trim();
                            if (name && name !== route.displayName) {
                              void persist({
                                ...route,
                                displayName: name,
                              }).catch((error) =>
                                toast.error(errorText(error)),
                              );
                            }
                          }}
                        />
                        <span
                          className={`u-tag ${routeIsAuto(route) ? "u-auto-tag" : ""}`}
                        >
                          {routeIsAuto(route) ? "自动路由" : "单对单"}
                        </span>
                        {availability.available === 0 && (
                          <span className="u-tag u-tag-danger">无可用目标</span>
                        )}
                        {availability.partial && (
                          <span className="u-tag u-tag-warning">
                            可用 {availability.available}/{availability.total}
                          </span>
                        )}
                        <code>{route.model}</code>
                      </div>
                      <div
                        className="mt-1 text-xs"
                        style={{ color: "var(--u-muted)" }}
                      >
                        {targetEntries.length
                          ? targetEntries
                              .map(
                                ({ id, index }) =>
                                  `${index + 1}. ${providerLabel(route, id)}`,
                              )
                              .join(" · ")
                          : "暂无可用供应商目标"}
                      </div>
                      {open && (
                        <div className="mt-2 space-y-1">
                          {targetEntries.map(({ id, index }, visibleIndex) => (
                            <div
                              key={`${id}-${index}`}
                              draggable
                              onDragStart={() => setDragFrom(index)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => {
                                if (dragFrom !== null) {
                                  void moveTarget(route, dragFrom, index);
                                }
                                setDragFrom(null);
                              }}
                              className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs"
                            >
                              <span className="cursor-move">⋮⋮</span>
                              <span className="flex-1">
                                {index + 1}. {providerLabel(route, id)}
                              </span>
                              <button
                                className="u-quiet"
                                type="button"
                                disabled={visibleIndex === 0}
                                onClick={() =>
                                  void moveTarget(
                                    route,
                                    index,
                                    targetEntries[visibleIndex - 1].index,
                                  )
                                }
                              >
                                上移
                              </button>
                              <button
                                className="u-quiet"
                                type="button"
                                disabled={
                                  visibleIndex === targetEntries.length - 1
                                }
                                onClick={() =>
                                  void moveTarget(
                                    route,
                                    index,
                                    targetEntries[visibleIndex + 1].index,
                                  )
                                }
                              >
                                下移
                              </button>
                              <button
                                className="u-quiet u-danger"
                                type="button"
                                onClick={() =>
                                  void persist({
                                    ...route,
                                    targets: route.targets.filter(
                                      (_item, itemIndex) => itemIndex !== index,
                                    ),
                                  }).catch((error) =>
                                    toast.error(errorText(error)),
                                  )
                                }
                              >
                                移除
                              </button>
                            </div>
                          ))}
                          {!targetEntries.length && (
                            <div className="u-empty py-3">
                              当前没有可用供应商目标
                            </div>
                          )}
                          <select
                            value=""
                            onChange={(event) => {
                              if (!event.target.value) return;
                              void persist({
                                ...route,
                                targets: [...route.targets, event.target.value],
                              }).catch((error) =>
                                toast.error(errorText(error)),
                              );
                            }}
                          >
                            <option value="">+ 添加供应商目标</option>
                            {resources
                              .filter(
                                (resource) =>
                                  resource.models.some(
                                    (model) =>
                                      modelGroupKey(model.slug) ===
                                      modelGroupKey(route.model),
                                  ) && !route.targets.includes(resource.id),
                              )
                              .map((resource) => (
                                <option key={resource.id} value={resource.id}>
                                  {resource.ownerName} 的 {resource.name}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <button
                      className={`u-quiet ${
                        selected.has(slug) ? "" : "u-sync-add"
                      }`}
                      type="button"
                      disabled={saving || selected.has(slug)}
                      onClick={() => void addRouteToSync(route)}
                    >
                      {selected.has(slug) ? "已加入" : "加入同步"}
                    </button>
                    <button
                      className="u-quiet"
                      type="button"
                      onClick={() => setExpanded(open ? null : route.id)}
                    >
                      {open ? "收起" : "映射"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>没有匹配的模型。</Empty>
          )}
          <div className="u-pagination">
            <span>共 {filtered.length} 条 · 每页 10 条</span>
            <button
              className="u-quiet"
              type="button"
              disabled={current <= 1}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </button>
            <span>
              第 {current} / {totalPages} 页
            </span>
            <button
              className="u-quiet"
              type="button"
              disabled={current >= totalPages}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </div>
      <Keys generation={generation} />
    </>
  );
}

type GrantRow = {
  userId: string;
  username: string;
  allowed: boolean | number;
  budget: string;
  models: string;
  expires_at?: number | null;
};

type ModelRoute = {
  id: string;
  displayName: string;
  model: string;
  targets: string[];
  auto: boolean;
  targetDetails?: {
    id: string;
    name: string;
    ownerName: string;
    routeKey: string;
    usable: boolean;
  }[];
  availableTargetCount?: number;
  enabled: boolean;
};

function Allocations({ generation }: { generation: number }) {
  const session = useUnitSession();
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<
    "policy" | "usage" | "grants" | "codes" | "applications"
  >("policy");
  const [usageSort, setUsageSort] = useState<"requests" | "tokens" | "cost">(
    "requests",
  );
  const [usageSearch, setUsageSearch] = useState("");
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [userUsage, setUserUsage] = useState<any[]>([]);
  const [codes, setCodes] = useState<ShareCode[]>([]);
  const [applications, setApplications] = useState<{
    mine: ApplicationRow[];
    received: ApplicationRow[];
  }>({ mine: [], received: [] });
  // 批阅时可以调整申请参数：时间截止、模型、以及说明。
  const [decisions, setDecisions] = useState<
    Record<
      string,
      { deadline: string; models: string[]; note: string; budget: Budget }
    >
  >({});
  const [createdCode, setCreatedCode] = useState<ShareCode | null>(null);
  const shareInviteText = (url: string) =>
    `${session?.me.user.username ?? "我"} 分享了「${selected?.name ?? "供应商"}」的访问口令：${url}`;
  const [policy, setPolicy] = useState<Policy>(defaultPolicy());
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingUser, setEditingUser] = useState("");
  const [username, setUsername] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [grantBudget, setGrantBudget] = useState<Budget>({});
  const [grantModels, setGrantModels] = useState<string[]>([]);
  const [expires, setExpires] = useState("");
  const [codeBudget, setCodeBudget] = useState<Budget>({});
  const [codeModels, setCodeModels] = useState<string[]>([]);
  const [codeExpires, setCodeExpires] = useState("");
  const [maxClaims, setMaxClaims] = useState(1);
  const [role, setRole] = useState<"owner" | "applicant">("owner");

  const selected = resources.find((resource) => resource.id === selectedId);
  const selectedCodes = codes.filter((code) => code.resourceId === selectedId);
  const ownedResources = resources.filter(
    (resource) => resource.owned && !resource.disabled,
  );
  const accessibleResources = resources.filter(
    (resource) => !resource.owned && resource.published && !resource.disabled,
  );
  const selectedReceived = applications.received.filter(
    (application) =>
      application.resourceId === selectedId && application.state === "pending",
  );
  const receivedAll = applications.received.filter(
    (application) => application.resourceId === selectedId,
  );
  // 每个供应商还有多少条待处理申请，用于左侧列表高亮。
  const pendingByResource: Record<string, number> = {};
  for (const application of applications.received) {
    if (application.state === "pending") {
      pendingByResource[application.resourceId] =
        (pendingByResource[application.resourceId] ?? 0) + 1;
    }
  }
  const myApplications = applications.mine;

  const decisionFor = (application: ApplicationRow) =>
    decisions[application.id] ?? {
      deadline: deadlineToInput(application.requestedExpiresAt),
      models: application.models,
      note: "",
      budget: application.budget,
    };
  const updateDecision = (
    application: ApplicationRow,
    patch: Partial<{
      deadline: string;
      models: string[];
      note: string;
      budget: Budget;
    }>,
  ) =>
    setDecisions((current) => ({
      ...current,
      [application.id]: { ...decisionFor(application), ...patch },
    }));

  const loadResources = useCallback(async () => {
    const [all, shareCodes] = await Promise.all([
      unit<Resource[]>("/resources"),
      unit<ShareCode[]>("/share-codes"),
    ]);
    const owned = all.filter(
      (resource) => resource.owned && !resource.disabled,
    );
    setResources(all);
    setCodes(shareCodes);
    setSelectedId((current) =>
      owned.some((resource) => resource.id === current)
        ? current
        : owned[0]?.id || "",
    );
  }, []);

  const loadDetails = useCallback(async () => {
    if (!selectedId) {
      setGrants([]);
      return;
    }
    const [grantRows, usageRows] = await Promise.all([
      unit<GrantRow[]>(`/resources/${selectedId}/grants`),
      unit<any[]>(`/resources/${selectedId}/user-usage`),
    ]);
    setGrants(grantRows);
    setUserUsage(usageRows);
  }, [selectedId]);

  // 申请记录和「选中哪个供应商」无关：没有自有供应商时也要能看自己的申请。
  const loadApplications = useCallback(async () => {
    setApplications(
      await unit<{ mine: ApplicationRow[]; received: ApplicationRow[] }>(
        "/applications",
      ),
    );
  }, []);

  useEffect(() => {
    let live = true;
    setBusy(true);
    void loadResources()
      .catch((error) => toast.error(errorText(error)))
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [generation, loadResources]);

  useEffect(() => {
    if (!selected) return;
    setPolicy(selected.policy || defaultPolicy());
    setCodeModels([]);
    setCreatedCode(null);
  }, [selected?.id, selected?.policy]);

  useEffect(() => {
    let live = true;
    if (!selectedId) {
      setGrants([]);
      return;
    }
    void loadDetails().catch((error) => {
      if (live) toast.error(errorText(error));
    });
    return () => {
      live = false;
    };
  }, [generation, loadDetails, selectedId]);

  useEffect(() => {
    let live = true;
    void loadApplications().catch((error) => {
      if (live) toast.error(errorText(error));
    });
    return () => {
      live = false;
    };
  }, [generation, loadApplications]);

  const changePublication = async (published: boolean) => {
    if (!selected) return;
    try {
      await unit(`/resources/${selected.id}/publication`, "PUT", { published });
      setResources((current) =>
        current.map((item) =>
          item.id === selected.id ? { ...item, published } : item,
        ),
      );
      toast.success(published ? "已上架供应商市场" : "已下架供应商市场");
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const resetGrantForm = () => {
    setEditingUser("");
    setUsername("");
    setAllowed(true);
    setGrantBudget({});
    setGrantModels([]);
    setExpires("");
  };

  const savePolicy = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await unit(`/resources/${selected.id}/policy`, "PUT", policy);
      setResources((current) =>
        current.map((resource) =>
          resource.id === selected.id ? { ...resource, policy } : resource,
        ),
      );
      toast.success("共享范围与默认额度已保存");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const saveAutoApprove = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const nextPolicy: Policy = {
      ...policy,
      autoApprove: policy.autoApprove ?? { enabled: false },
    };
    setSaving(true);
    try {
      await unit(`/resources/${selected.id}/policy`, "PUT", nextPolicy);
      setResources((current) =>
        current.map((resource) =>
          resource.id === selected.id
            ? { ...resource, policy: nextPolicy }
            : resource,
        ),
      );
      toast.success("免审设置已保存");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const decideApplication = async (
    application: ApplicationRow,
    approve: boolean,
  ) => {
    const decision = decisionFor(application);
    const deadline = inputToDeadline(decision.deadline);
    if (approve && deadline !== null && deadline * 1000 <= Date.now()) {
      toast.error("时间截止必须晚于当前时间");
      return;
    }
    try {
      await unit(`/applications/${application.id}/decision`, "POST", {
        approve,
        budget: approve ? decision.budget : {},
        models: approve ? decision.models : [],
        expiresAt: approve ? deadline : null,
        note: decision.note,
      });
      toast.success(approve ? "已同意申请并写入授权" : "已驳回申请");
      setDecisions((current) => {
        const next = { ...current };
        delete next[application.id];
        return next;
      });
      await Promise.all([loadDetails(), loadResources(), loadApplications()]);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const cancelApplication = async (application: ApplicationRow) => {
    try {
      await unit(`/applications/${application.id}`, "DELETE");
      toast.success("已撤销申请");
      await Promise.all([loadDetails(), loadApplications()]);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const saveGrant = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      await unit(`/resources/${selected.id}/grants`, "PUT", {
        username,
        allowed,
        budget: grantBudget,
        models: grantModels,
        expiresAt: expires
          ? Math.floor(new Date(expires).getTime() / 1000)
          : null,
      });
      await loadDetails();
      resetGrantForm();
      toast.success("用户分配已保存");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const removeGrant = async (row: GrantRow) => {
    if (!selected) return;
    try {
      await unit(
        `/resources/${selected.id}/grants/${encodeURIComponent(row.userId)}`,
        "DELETE",
      );
      await loadDetails();
      if (editingUser === row.userId) resetGrantForm();
      toast.success(`已移除 ${row.username} 的单独分配`);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const createCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    try {
      const result = await unit<ShareCode>(
        `/resources/${selected.id}/share-codes`,
        "POST",
        {
          budget: codeBudget,
          models: codeModels,
          expiresAt: codeExpires
            ? Math.floor(new Date(codeExpires).getTime() / 1000)
            : null,
          maxClaims,
        },
      );
      setCreatedCode(result);
      setCodes((current) => [result, ...current]);
      setCodeBudget({});
      setCodeModels([]);
      setCodeExpires("");
      setMaxClaims(1);
      toast.success("分享口令已创建，请在离开前复制引导口令");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const revokeCode = async (code: ShareCode) => {
    try {
      await unit(`/share-codes/${code.id}`, "DELETE");
      setCodes((current) =>
        current.map((item) =>
          item.id === code.id ? { ...item, active: false } : item,
        ),
      );
      if (createdCode?.id === code.id) setCreatedCode(null);
      toast.success("分享口令已撤销");
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const modelPicker = (
    value: string[],
    change: (next: string[]) => void,
    source?: Resource["models"],
  ) => (
    <div className="u-model-picker" aria-label="允许的模型">
      {(source ?? selected?.models ?? []).map((model) => {
        const active = value.includes(model.slug);
        return (
          <button
            key={model.slug}
            type="button"
            className={`u-model-choice ${active ? "active" : ""}`}
            onClick={() =>
              change(
                active
                  ? value.filter((slug) => slug !== model.slug)
                  : [...value, model.slug],
              )
            }
          >
            {model.display_name || model.slug}
          </button>
        );
      })}
      <small>不选择模型表示允许该供应商当前发布的所有模型。</small>
    </div>
  );

  // 申请方和提供方看到同一份申请记录，包含申请参数与批阅结果。
  const myApplicationsTable = (
    <div className="u-table-wrap">
      <table>
        <thead>
          <tr>
            <th>供应商</th>
            <th>提供者</th>
            <th>申请条件</th>
            <th>期望截止</th>
            <th>处理结果</th>
            <th>生效额度</th>
            <th>生效截止</th>
            <th>批阅说明</th>
            <th>提交时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {myApplications.map((application) => (
            <tr key={application.id}>
              <td>{application.resourceName}</td>
              <td>{application.counterpartyName}</td>
              <td>
                {budgetText(application.budget)}
                {" · "}
                {application.models.length
                  ? `限定 ${application.models.length} 个模型`
                  : "全部模型"}
              </td>
              <td>{deadlineText(application.requestedExpiresAt)}</td>
              <td>
                <span
                  className={`u-tag ${
                    application.state === "approved" ? "u-green" : ""
                  }`}
                >
                  {decisionLabel(application)}
                </span>
              </td>
              <td>
                {application.state === "approved"
                  ? budgetText(application.decidedBudget || {})
                  : "—"}
              </td>
              <td>
                {application.state === "approved"
                  ? deadlineText(application.decidedExpiresAt)
                  : "—"}
              </td>
              <td>{application.decisionNote || "—"}</td>
              <td>{date(application.createdAt)}</td>
              <td>
                {application.state === "pending" && (
                  <button
                    type="button"
                    className="u-quiet u-danger"
                    onClick={() => void cancelApplication(application)}
                  >
                    <Trash2 size={13} />
                    撤销
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderApplicantView = () => (
    <>
      <section className="u-panel">
        <div className="u-panel-title">
          <WalletCards size={17} />
          我获得的授权
          <small>{accessibleResources.length} 个供应商</small>
        </div>
        {accessibleResources.length ? (
          <div className="u-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>供应商</th>
                  <th>提供者</th>
                  <th>请求次数</th>
                  <th>Token 数量</th>
                  <th>时间截止</th>
                  <th>可用模型</th>
                  <th>额度来源</th>
                </tr>
              </thead>
              <tbody>
                {accessibleResources.map((resource) => (
                  <tr key={resource.id}>
                    <td>{resource.name}</td>
                    <td>{resource.ownerName}</td>
                    <td>
                      {resource.myBudget?.requests == null
                        ? "不限"
                        : `${num(resource.myBudget.requests)} 次`}
                    </td>
                    <td>
                      {resource.myBudget?.tokens == null
                        ? "不限"
                        : `${num(resource.myBudget.tokens)} Token`}
                    </td>
                    <td>{deadlineText(resource.myExpiresAt)}</td>
                    <td>
                      {resource.models.length
                        ? `${resource.models.length} 个`
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={`u-tag ${
                          resource.grantSource === "owner" ? "u-green" : ""
                        }`}
                      >
                        {grantSourceText(resource.grantSource)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            还没有获得其他用户的授权，可在“供应商工作台 → 供应商库”里申请。
          </Empty>
        )}
      </section>
    </>
  );

  return (
    <>
      <div className="u-segmented" role="tablist" style={{ marginBottom: 18 }}>
        <button
          type="button"
          role="tab"
          aria-selected={role === "owner"}
          className={role === "owner" ? "active" : ""}
          onClick={() => setRole("owner")}
        >
          <WalletCards size={15} />
          分配方（我提供的）
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={role === "applicant"}
          className={role === "applicant" ? "active" : ""}
          onClick={() => setRole("applicant")}
        >
          <UserPlus size={15} />
          申请方（我申请的）
          {myApplications.filter((item) => item.state === "pending").length
            ? ` ${myApplications.filter((item) => item.state === "pending").length}`
            : ""}
        </button>
      </div>
      {role === "applicant" ? (
        renderApplicantView()
      ) : busy ? (
        <Empty>
          <Busy />
        </Empty>
      ) : !ownedResources.length ? (
        <Empty>
          还没有可分配的供应商。请先在“我的供应商”中创建、发布并启用资源。
        </Empty>
      ) : (
        <div className="u-allocation-layout">
          <div className="u-allocation-list u-allocation-top">
            <div className="u-allocation-list-head">
              <strong>我的供应商</strong>
              <span>{ownedResources.length}</span>
            </div>
            {ownedResources.map((resource) => {
              const pending = pendingByResource[resource.id] ?? 0;
              return (
                <button
                  key={resource.id}
                  type="button"
                  className={`u-allocation-item ${
                    resource.id === selectedId ? "active" : ""
                  } ${pending > 0 ? "has-requests" : ""}`}
                  onClick={() => {
                    setSelectedId(resource.id);
                    resetGrantForm();
                  }}
                >
                  <span className="u-allocation-name">
                    {resource.name}
                    {pending > 0 && (
                      <span
                        className="u-allocation-count"
                        title={`${pending} 条待处理申请`}
                      >
                        {pending > 99 ? "99+" : pending}
                      </span>
                    )}
                  </span>
                  <small>
                    {resource.appType.toUpperCase()} ·{" "}
                    {resource.published ? "已发布" : "未发布"}
                  </small>
                </button>
              );
            })}
          </div>
          {selected && (
            <section className="u-allocation-main">
              <div className="u-allocation-head">
                <div>
                  <h2>{selected.name}</h2>
                </div>
                <span
                  className={`u-tag ${
                    selected.published ? "u-green" : "u-warning"
                  }`}
                >
                  {selected.published ? "可分配" : "尚未发布"}
                </span>
              </div>

              <div className="u-segmented" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "policy"}
                  className={mode === "policy" ? "active" : ""}
                  onClick={() => setMode("policy")}
                >
                  <Users size={15} />
                  可见性与共享
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "usage"}
                  className={mode === "usage" ? "active" : ""}
                  onClick={() => setMode("usage")}
                >
                  <BarChart3 size={15} />
                  用户用量
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "grants"}
                  className={mode === "grants" ? "active" : ""}
                  onClick={() => setMode("grants")}
                >
                  <Users size={15} />
                  用户权限
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "codes"}
                  className={mode === "codes" ? "active" : ""}
                  onClick={() => setMode("codes")}
                >
                  <KeyRound size={15} />
                  分享口令
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "applications"}
                  className={mode === "applications" ? "active" : ""}
                  onClick={() => setMode("applications")}
                >
                  <UserPlus size={15} />
                  申请审批
                  {selectedReceived.length > 0
                    ? ` ${selectedReceived.length}`
                    : ""}
                </button>
              </div>

              {mode === "policy" || mode === "usage" || mode === "grants" ? (
                <>
                  {mode === "policy" && (
                    <section className="u-panel">
                      <div className="u-panel-title">
                        <Users size={17} />
                        可见性与共享
                        <small>
                          控制这个供应商对其他用户是否可见、可按什么额度使用
                        </small>
                      </div>
                      <form className="u-panel-body" onSubmit={savePolicy}>
                        <Field label="供应商市场">
                          <div className="u-market-row">
                            <div className="u-visibility-toggle">
                              <button
                                type="button"
                                className={selected.published ? "active" : ""}
                                onClick={() => void changePublication(true)}
                              >
                                上架
                              </button>
                              <button
                                type="button"
                                className={!selected.published ? "active" : ""}
                                onClick={() => void changePublication(false)}
                              >
                                下架
                              </button>
                            </div>
                            <p className="u-note u-market-hint">
                              {selected.published
                                ? "已上架：所有用户都能在供应商库看到并提交申请。"
                                : "已下架：不会出现在供应商库，其他人无法申请，但可通过分享口令私下授权使用。"}
                            </p>
                          </div>
                        </Field>
                        <p className="u-note">
                          额度完全由申请审批或指定授权决定，不再提供默认额度、共享预算或按周期重置。
                        </p>
                        <Field label="对外可见的模型（留空表示该供应商全部模型）">
                          {modelPicker(policy.models, (value) =>
                            setPolicy({ ...policy, models: value }),
                          )}
                        </Field>
                        <button
                          className="u-button"
                          disabled={saving}
                          type="submit"
                        >
                          {saving ? <Busy /> : "保存可见性与共享设置"}
                        </button>
                      </form>
                    </section>
                  )}

                  {mode === "usage" && (
                    <section className="u-panel">
                      <div className="u-panel-title">
                        <BarChart3 size={17} />
                        用户用量
                        <small>按近 30 天请求次数排行</small>
                      </div>
                      {(() => {
                        const totalReq = userUsage.reduce(
                          (sum, row) => sum + (row.requests ?? 0),
                          0,
                        );
                        const totalTok = userUsage.reduce(
                          (sum, row) => sum + (row.tokens ?? 0),
                          0,
                        );
                        const totalCost = userUsage.reduce(
                          (sum, row) => sum + (row.costCredits ?? 0),
                          0,
                        );
                        const keyword = usageSearch.trim().toLowerCase();
                        const rows = [...userUsage]
                          .filter((row) =>
                            keyword
                              ? String(row.username ?? "")
                                  .toLowerCase()
                                  .includes(keyword)
                              : true,
                          )
                          .sort((a, b) =>
                            usageSort === "tokens"
                              ? (b.tokens ?? 0) - (a.tokens ?? 0)
                              : usageSort === "cost"
                                ? (b.costCredits ?? 0) - (a.costCredits ?? 0)
                                : (b.requests ?? 0) - (a.requests ?? 0),
                          );
                        return (
                          <>
                            <div className="u-usage-summary">
                              <div className="u-card">
                                <small>近 30 天请求</small>
                                <strong>{num(totalReq)}</strong>
                              </div>
                              <div className="u-card">
                                <small>近 30 天 Token</small>
                                <strong>{num(totalTok)}</strong>
                              </div>
                              <div className="u-card">
                                <small>近 30 天成本</small>
                                <strong>{dollars(totalCost)}</strong>
                              </div>
                              <div className="u-card">
                                <small>活跃用户</small>
                                <strong>
                                  {
                                    userUsage.filter(
                                      (row) => (row.requests ?? 0) > 0,
                                    ).length
                                  }
                                </strong>
                              </div>
                            </div>
                            <div
                              className="u-toolbar"
                              style={{ padding: "0 16px 18px" }}
                            >
                              <div className="u-search">
                                <Search size={15} />
                                <input
                                  placeholder="搜索用户"
                                  value={usageSearch}
                                  onChange={(event) =>
                                    setUsageSearch(event.target.value)
                                  }
                                />
                              </div>
                              <select
                                value={usageSort}
                                onChange={(event) =>
                                  setUsageSort(
                                    event.target.value as
                                      | "requests"
                                      | "tokens"
                                      | "cost",
                                  )
                                }
                              >
                                <option value="requests">按请求次数排序</option>
                                <option value="tokens">按 Token 排序</option>
                                <option value="cost">按成本排序</option>
                              </select>
                            </div>
                            <div
                              className="u-table-wrap"
                              style={{ marginBottom: 18 }}
                            >
                              <table>
                                <thead>
                                  <tr>
                                    <th>排名</th>
                                    <th>用户</th>
                                    <th>请求次数</th>
                                    <th>请求使用率</th>
                                    <th>Token</th>
                                    <th>Token 使用率</th>
                                    <th>成本</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((row, index) => {
                                    let tokenLimit: number | null = null;
                                    let requestLimit: number | null = null;
                                    try {
                                      const parsedBudget = JSON.parse(
                                        row.budget || "{}",
                                      );
                                      tokenLimit = parsedBudget.tokens ?? null;
                                      requestLimit =
                                        parsedBudget.requests ?? null;
                                    } catch {
                                      tokenLimit = null;
                                      requestLimit = null;
                                    }
                                    const requestPct =
                                      requestLimit && requestLimit > 0
                                        ? ((row.requests ?? 0) / requestLimit) *
                                          100
                                        : null;
                                    const quotaPct =
                                      tokenLimit && tokenLimit > 0
                                        ? ((row.tokens ?? 0) / tokenLimit) * 100
                                        : null;
                                    return (
                                      <tr key={row.user_id}>
                                        <td>{index + 1}</td>
                                        <td>{row.username}</td>
                                        <td>{num(row.requests ?? 0)}</td>
                                        <td>
                                          {requestPct == null ? (
                                            <span className="u-unlimited">
                                              UNLIMITED
                                            </span>
                                          ) : (
                                            <div className="flex items-center gap-2">
                                              <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                                                <div
                                                  className="h-full rounded-full bg-primary"
                                                  style={{
                                                    width: `${Math.min(100, requestPct)}%`,
                                                  }}
                                                />
                                              </div>
                                              <span>
                                                {requestPct.toFixed(1)}%
                                              </span>
                                            </div>
                                          )}
                                        </td>
                                        <td>
                                          {compactTokens(row.tokens ?? 0)}
                                        </td>
                                        <td>
                                          {quotaPct == null ? (
                                            <span className="u-unlimited">
                                              UNLIMITED
                                            </span>
                                          ) : (
                                            <div className="flex items-center gap-2">
                                              <div className="h-2 w-20 overflow-hidden rounded-full bg-muted">
                                                <div
                                                  className="h-full rounded-full bg-primary"
                                                  style={{
                                                    width: `${Math.min(100, quotaPct)}%`,
                                                  }}
                                                />
                                              </div>
                                              <span>
                                                {quotaPct.toFixed(1)}%
                                              </span>
                                            </div>
                                          )}
                                        </td>
                                        <td>{dollars(row.costCredits ?? 0)}</td>
                                        <td />
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            {rows.length > 0 && (
                              <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
                                {(
                                  [
                                    ["请求占比", "requests", totalReq],
                                    ["Token 占比", "tokens", totalTok],
                                  ] as const
                                ).map(([title, key, total]) => {
                                  const colors = [
                                    "#6366f1",
                                    "#22c55e",
                                    "#f59e0b",
                                    "#ef4444",
                                    "#06b6d4",
                                    "#a855f7",
                                    "#ec4899",
                                    "#84cc16",
                                  ];
                                  let acc = 0;
                                  const stops: string[] = [];
                                  rows.forEach((row, index) => {
                                    const share =
                                      total > 0
                                        ? ((row[key] ?? 0) / total) * 100
                                        : 0;
                                    stops.push(
                                      `${colors[index % colors.length]} ${acc.toFixed(2)}% ${(acc + share).toFixed(2)}%`,
                                    );
                                    acc += share;
                                  });
                                  return (
                                    <div
                                      key={key}
                                      className="rounded-lg border border-border-default p-4"
                                    >
                                      <div className="text-sm font-medium text-foreground">
                                        {title}
                                      </div>
                                      <div className="mt-3 flex flex-wrap items-center gap-5">
                                        <div
                                          className="h-32 w-32 shrink-0 rounded-full"
                                          style={{
                                            background:
                                              total > 0
                                                ? `conic-gradient(${stops.join(",")})`
                                                : "hsl(var(--muted))",
                                          }}
                                        />
                                        <ul className="space-y-1 text-xs text-muted-foreground">
                                          {rows
                                            .slice(0, 8)
                                            .map((row, index) => (
                                              <li
                                                key={row.user_id}
                                                className="flex items-center gap-2"
                                              >
                                                <span
                                                  className="inline-block h-2 w-2 rounded-full"
                                                  style={{
                                                    background:
                                                      colors[
                                                        index % colors.length
                                                      ],
                                                  }}
                                                />
                                                <span className="text-foreground">
                                                  {row.username}
                                                </span>
                                                <span>
                                                  {total > 0
                                                    ? (
                                                        ((row[key] ?? 0) /
                                                          total) *
                                                        100
                                                      ).toFixed(1)
                                                    : "0.0"}
                                                  %
                                                </span>
                                              </li>
                                            ))}
                                        </ul>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {!rows.length && <Empty>没有匹配的用户。</Empty>}
                          </>
                        );
                      })()}
                    </section>
                  )}
                  {mode === "grants" && (
                    <section className="u-panel">
                      <div className="u-panel-title">
                        <UserPlus size={17} />
                        用户权限
                        <small>{grants.length} 个单独分配</small>
                      </div>
                      <div className="u-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>用户</th>
                              <th>权限</th>
                              <th>单独额度</th>
                              <th>模型范围</th>
                              <th>到期时间</th>
                              <th>近 30 天请求</th>
                              <th>Token</th>
                              <th>成本</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {userUsage.map((row) => {
                              const rowModels = parseModels(row.models);
                              return (
                                <tr key={row.userId}>
                                  <td>{row.username}</td>
                                  <td>
                                    <span
                                      className={`u-tag ${
                                        row.allowed ? "u-green" : "u-danger"
                                      }`}
                                    >
                                      {row.allowed ? "允许" : "禁用"}
                                    </span>
                                  </td>
                                  <td>{budgetText(parseBudget(row.budget))}</td>
                                  <td>
                                    {rowModels.length
                                      ? rowModels.join(", ")
                                      : "全部已发布模型"}
                                  </td>
                                  <td>{date(row.expires_at || undefined)}</td>
                                  <td>{num(row.requests ?? 0)}</td>
                                  <td>{num(row.tokens ?? 0)}</td>
                                  <td>{dollars(row.costCredits ?? 0)}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="u-quiet"
                                      onClick={() => {
                                        setEditingUser(row.userId);
                                        setUsername(row.username);
                                        setAllowed(!!row.allowed);
                                        setGrantBudget(parseBudget(row.budget));
                                        setGrantModels(rowModels);
                                        setExpires(
                                          row.expires_at
                                            ? new Date(row.expires_at * 1000)
                                                .toISOString()
                                                .slice(0, 16)
                                            : "",
                                        );
                                      }}
                                    >
                                      编辑
                                    </button>
                                    <button
                                      type="button"
                                      className="u-quiet u-danger"
                                      onClick={() => void removeGrant(row)}
                                    >
                                      <Trash2 size={13} />
                                      移除
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {!userUsage.length && (
                        <Empty>
                          还没有单独分配。公开或指定用户模式可先使用共享规则。
                        </Empty>
                      )}
                      <form
                        className="u-panel-body u-form-divider"
                        onSubmit={saveGrant}
                      >
                        <div className="u-form-head">
                          <strong>
                            {editingUser ? "编辑用户分配" : "新增用户分配"}
                          </strong>
                          {editingUser && (
                            <button
                              type="button"
                              className="u-quiet"
                              onClick={resetGrantForm}
                            >
                              取消编辑
                            </button>
                          )}
                        </div>
                        <div className="u-grid2">
                          <Field label="平台用户名">
                            <input
                              required
                              disabled={!!editingUser}
                              value={username}
                              onChange={(event) =>
                                setUsername(event.target.value)
                              }
                            />
                          </Field>
                          <Field label="授权">
                            <select
                              value={String(allowed)}
                              onChange={(event) =>
                                setAllowed(event.target.value === "true")
                              }
                            >
                              <option value="true">允许使用</option>
                              <option value="false">禁用此用户</option>
                            </select>
                          </Field>
                        </div>
                        <BudgetFields
                          title="此用户的独立额度"
                          value={grantBudget}
                          change={setGrantBudget}
                        />
                        <div className="u-grid2">
                          <Field label="允许的模型（留空为全部）">
                            {modelPicker(
                              grantModels,
                              setGrantModels,
                              selected?.visibleModels,
                            )}
                          </Field>
                          <Field label="到期时间（可留空）">
                            <input
                              type="datetime-local"
                              value={expires}
                              onChange={(event) =>
                                setExpires(event.target.value)
                              }
                            />
                          </Field>
                        </div>
                        <button
                          className="u-button"
                          disabled={saving}
                          type="submit"
                        >
                          {saving ? <Busy /> : "保存用户分配"}
                        </button>
                      </form>
                    </section>
                  )}
                </>
              ) : mode === "codes" ? (
                <>
                  {createdCode?.url && (
                    <div className="u-created u-created-panel">
                      <div>
                        <h2>分享口令已创建</h2>
                        <p>
                          把下面这段发给对方，对方登录后打开链接即可领取额度（仅显示一次，额度先到先得）。
                        </p>
                      </div>
                      <code>{createdCode.url}</code>
                      <div className="u-actions">
                        <button
                          type="button"
                          className="u-button"
                          onClick={() =>
                            void copy(shareInviteText(createdCode.url!))
                          }
                        >
                          <Link2 size={14} />
                          复制引导口令
                        </button>
                        <button
                          type="button"
                          className="u-quiet"
                          onClick={() => void copy(createdCode.token || "")}
                        >
                          <Copy size={14} />
                          复制口令
                        </button>
                        <button
                          type="button"
                          className="u-quiet"
                          onClick={() => setCreatedCode(null)}
                        >
                          隐藏
                        </button>
                      </div>
                    </div>
                  )}
                  <section className="u-panel">
                    <div className="u-panel-title">
                      <KeyRound size={17} />
                      创建分享口令
                      <small>领取后写入指定用户额度</small>
                    </div>
                    <form className="u-panel-body" onSubmit={createCode}>
                      <p className="u-note">
                        口令可限制领取次数和到期时间。已领取的授权不会因撤销口令而收回。
                      </p>
                      <BudgetFields
                        title="每位领取者获得的额度"
                        value={codeBudget}
                        change={setCodeBudget}
                        hideCredits
                      />
                      <div className="u-grid2">
                        <Field label="允许的模型（留空为全部）">
                          {modelPicker(
                            codeModels,
                            setCodeModels,
                            selected?.visibleModels,
                          )}
                        </Field>
                        <div>
                          <Field label="到期时间（可留空）">
                            <input
                              type="datetime-local"
                              value={codeExpires}
                              onChange={(event) =>
                                setCodeExpires(event.target.value)
                              }
                            />
                          </Field>
                          <Field
                            label="最多领取次数"
                            hint="默认 1，可设置 1—1000000。"
                          >
                            <input
                              required
                              type="number"
                              min={1}
                              max={1000000}
                              value={maxClaims}
                              onChange={(event) =>
                                setMaxClaims(Number(event.target.value))
                              }
                            />
                          </Field>
                        </div>
                      </div>
                      <button
                        className="u-button"
                        disabled={saving || !selected.published}
                        type="submit"
                      >
                        {saving ? <Busy /> : "生成分享链接"}
                      </button>
                      {!selected.published && (
                        <small className="u-error">
                          请先发布该供应商，再创建分享口令。
                        </small>
                      )}
                    </form>
                  </section>
                  <section className="u-panel">
                    <div className="u-panel-title">
                      <Link2 size={17} />
                      已创建的口令
                      <small>{selectedCodes.length} 条</small>
                    </div>
                    <div className="u-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>额度</th>
                            <th>模型</th>
                            <th>领取进度</th>
                            <th>到期时间</th>
                            <th>状态</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCodes.map((code) => {
                            const exhausted =
                              code.claimedCount >= code.maxClaims;
                            const expired =
                              !!code.expiresAt &&
                              code.expiresAt <= Math.floor(Date.now() / 1000);
                            const active =
                              code.active && !exhausted && !expired;
                            return (
                              <tr key={code.id}>
                                <td>{budgetText(code.budget)}</td>
                                <td>
                                  {code.models.length
                                    ? code.models.join(", ")
                                    : "全部已发布模型"}
                                </td>
                                <td>
                                  {code.claimedCount} / {code.maxClaims}
                                </td>
                                <td>{date(code.expiresAt || undefined)}</td>
                                <td>
                                  <span
                                    className={`u-tag ${
                                      active ? "u-green" : ""
                                    }`}
                                  >
                                    {active
                                      ? "可领取"
                                      : exhausted
                                        ? "已领完"
                                        : expired
                                          ? "已过期"
                                          : "已撤销"}
                                  </span>
                                </td>
                                <td>
                                  {createdCode?.id === code.id &&
                                    createdCode.url && (
                                      <button
                                        type="button"
                                        className="u-quiet"
                                        onClick={() =>
                                          void copy(createdCode.url!)
                                        }
                                      >
                                        <Copy size={13} />
                                        复制引导口令
                                      </button>
                                    )}
                                  {code.active && (
                                    <button
                                      type="button"
                                      className="u-quiet u-danger"
                                      onClick={() => void revokeCode(code)}
                                    >
                                      <Trash2 size={13} />
                                      撤销
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {!selectedCodes.length && <Empty>还没有分享口令。</Empty>}
                  </section>
                </>
              ) : (
                <>
                  <section className="u-panel">
                    <div className="u-panel-title">
                      <UserPlus size={17} />
                      免审设置
                      <small>符合上限的申请自动通过，超出的转人工审批</small>
                    </div>
                    <form className="u-panel-body" onSubmit={saveAutoApprove}>
                      <label className="u-inline">
                        <input
                          type="checkbox"
                          checked={policy.autoApprove?.enabled ?? false}
                          onChange={(event) =>
                            setPolicy({
                              ...policy,
                              autoApprove: {
                                ...(policy.autoApprove || { enabled: false }),
                                enabled: event.target.checked,
                              },
                            })
                          }
                        />
                        开启免审：满足下列上限的申请直接通过
                      </label>
                      <div className="u-grid3">
                        <Field label="限定人数（人）">
                          <input
                            type="number"
                            min={0}
                            placeholder="不限"
                            value={policy.autoApprove?.maxUsers ?? ""}
                            onChange={(event) =>
                              setPolicy({
                                ...policy,
                                autoApprove: {
                                  ...(policy.autoApprove || { enabled: false }),
                                  maxUsers:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                },
                              })
                            }
                          />
                        </Field>
                        <Field label="总 Token 量">
                          <LimitField
                            kind="tokens"
                            value={policy.autoApprove?.totalTokens}
                            change={(totalTokens) =>
                              setPolicy({
                                ...policy,
                                autoApprove: {
                                  ...(policy.autoApprove || { enabled: false }),
                                  totalTokens,
                                },
                              })
                            }
                          />
                        </Field>
                        <Field label="单人最多申请 Token">
                          <LimitField
                            kind="tokens"
                            value={policy.autoApprove?.perUserTokens}
                            change={(perUserTokens) =>
                              setPolicy({
                                ...policy,
                                autoApprove: {
                                  ...(policy.autoApprove || { enabled: false }),
                                  perUserTokens,
                                },
                              })
                            }
                          />
                        </Field>
                      </div>
                      <button
                        className="u-button"
                        disabled={saving}
                        type="submit"
                      >
                        {saving ? <Busy /> : "保存免审设置"}
                      </button>
                    </form>
                  </section>

                  <section className="u-panel">
                    <div className="u-panel-title">
                      <Users size={17} />
                      收到的申请
                      <small>{selectedReceived.length} 条待处理</small>
                    </div>
                    {selectedReceived.length ? (
                      <div className="u-request-list">
                        {selectedReceived.map((application) => {
                          const decision = decisionFor(application);
                          return (
                            <article className="u-request" key={application.id}>
                              <header className="u-request-head">
                                <strong>
                                  {application.counterpartyName} 申请使用
                                </strong>
                                <span className="u-tag">
                                  提交于 {date(application.createdAt)}
                                </span>
                              </header>
                              {application.message && (
                                <p className="u-request-message">
                                  {application.message}
                                </p>
                              )}
                              <div className="u-request-meta">
                                <div>
                                  <small>请求次数</small>
                                  <strong>
                                    {application.budget.requests == null
                                      ? "不限"
                                      : `${num(application.budget.requests)} 次`}
                                  </strong>
                                </div>
                                <div>
                                  <small>Token 数量</small>
                                  <strong>
                                    {application.budget.tokens == null
                                      ? "不限"
                                      : `${num(application.budget.tokens)} Token`}
                                  </strong>
                                </div>
                                <div>
                                  <small>期望截止</small>
                                  <strong>
                                    {deadlineText(
                                      application.requestedExpiresAt,
                                    )}
                                  </strong>
                                </div>
                                <div>
                                  <small>模型范围</small>
                                  <strong>
                                    {application.models.length
                                      ? `${application.models.length} 个模型`
                                      : "全部可见模型"}
                                  </strong>
                                </div>
                              </div>
                              <div className="u-request-fields">
                                <BudgetFields
                                  title="批准额度（留空为不限）"
                                  value={decision.budget}
                                  change={(budget) =>
                                    updateDecision(application, { budget })
                                  }
                                  hideCredits
                                />
                                <div className="u-grid2">
                                  <Field label="时间截止（留空为不限）">
                                    <input
                                      type="datetime-local"
                                      value={decision.deadline}
                                      onChange={(event) =>
                                        updateDecision(application, {
                                          deadline: event.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                  <Field label="批阅说明（可选）">
                                    <input
                                      value={decision.note}
                                      placeholder="例如：先授权到本月底，到期可以再申请"
                                      onChange={(event) =>
                                        updateDecision(application, {
                                          note: event.target.value,
                                        })
                                      }
                                    />
                                  </Field>
                                </div>
                                <Field label="允许的模型（留空为全部可见模型）">
                                  {modelPicker(
                                    decision.models,
                                    (models) =>
                                      updateDecision(application, { models }),
                                    selected?.visibleModels,
                                  )}
                                </Field>
                              </div>
                              <footer className="u-request-actions">
                                <span className="u-request-hint">
                                  同意时按上面的参数写入授权；调整过参数会记录为“修改后同意”。
                                </span>
                                <button
                                  className="u-button"
                                  type="button"
                                  onClick={() =>
                                    void decideApplication(application, true)
                                  }
                                >
                                  同意授权
                                </button>
                                <button
                                  className="u-quiet u-danger"
                                  type="button"
                                  onClick={() =>
                                    void decideApplication(application, false)
                                  }
                                >
                                  驳回
                                </button>
                              </footer>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <Empty>当前供应商没有待处理的申请。</Empty>
                    )}
                  </section>

                  <section className="u-panel hidden">
                    <div className="u-panel-title">
                      <History size={17} />
                      申请记录
                      <small>
                        {receivedAll.length} 条 · 同意、修改、驳回都留痕
                      </small>
                    </div>
                    {receivedAll.length ? (
                      <div className="u-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>申请人</th>
                              <th>申请参数</th>
                              <th>期望截止</th>
                              <th>处理结果</th>
                              <th>生效额度</th>
                              <th>生效截止</th>
                              <th>批阅说明</th>
                              <th>处理时间</th>
                            </tr>
                          </thead>
                          <tbody>
                            {receivedAll.map((application) => (
                              <tr key={application.id}>
                                <td>{application.counterpartyName}</td>
                                <td>
                                  {budgetText(application.budget)}
                                  {" · "}
                                  {application.models.length
                                    ? `${application.models.length} 个模型`
                                    : "全部模型"}
                                </td>
                                <td>
                                  {deadlineText(application.requestedExpiresAt)}
                                </td>
                                <td>
                                  <span
                                    className={`u-tag ${
                                      application.state === "approved"
                                        ? "u-green"
                                        : ""
                                    }`}
                                  >
                                    {decisionLabel(application)}
                                  </span>
                                </td>
                                <td>
                                  {application.state === "approved"
                                    ? budgetText(
                                        application.decidedBudget || {},
                                      )
                                    : "—"}
                                </td>
                                <td>
                                  {application.state === "approved"
                                    ? deadlineText(application.decidedExpiresAt)
                                    : "—"}
                                </td>
                                <td>{application.decisionNote || "—"}</td>
                                <td>
                                  {date(application.decidedAt || undefined)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty>这个供应商还没有申请记录。</Empty>
                    )}
                  </section>

                  <section className="u-panel" style={{ display: "none" }}>
                    <div className="u-panel-title">
                      <WalletCards size={17} />
                      我的申请
                      <small>{myApplications.length} 条</small>
                    </div>
                    {myApplicationsTable}
                    {!myApplications.length && (
                      <Empty>还没有提交过申请。</Empty>
                    )}
                  </section>
                </>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
function Keys({ generation }: { generation: number }) {
  const [keys, setKeys] = useState<ApiKey[]>([]),
    [name, setName] = useState(""),
    [created, setCreated] = useState<{ key: string; command: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const load = useCallback(() => unit<ApiKey[]>("/keys").then(setKeys), []);
  useEffect(() => {
    void load().catch((e) => toast.error(errorText(e)));
  }, [load, generation]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setCreated(await unit("/keys", "POST", { name, expiresAt: null }));
      setName("");
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">设备与接入密钥</h3>
        <p className="text-xs text-muted-foreground">
          为每台主机创建独立密钥，用量归入你的账号，也能按设备查看。
        </p>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={create}>
        <Input
          required
          maxLength={100}
          placeholder="设备名称，例如 moss、nccl5"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-full max-w-xs"
        />
        <Button type="submit" size="sm" disabled={busy}>
          <Plus className="mr-1 h-4 w-4" />
          创建设备密钥
        </Button>
      </form>
      {created && (
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
          <h4 className="text-sm font-medium">复制到远程主机执行</h4>
          <p className="text-xs text-muted-foreground">
            密钥明文仅在本次显示。命令会备份配置、写入个人路由和模型目录，并尝试重启
            Codex app-server。
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs select-all">
            {created.command}
          </pre>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void copy(created.command)}>
              <Copy className="mr-1 h-4 w-4" />
              复制接入 / 更新命令
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copy(created.key)}
            >
              复制 API Key
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              隐藏
            </Button>
          </div>
        </div>
      )}
      {keys.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>设备</TableHead>
              <TableHead>密钥前缀</TableHead>
              <TableHead>最近使用</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id}>
                <TableCell>{k.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {k.prefix}…
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {date(k.last_used_at)}
                </TableCell>
                <TableCell>{k.active ? "启用" : "已撤销"}</TableCell>
                <TableCell className="text-right">
                  {!!k.active && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={async () => {
                        try {
                          await unit(`/keys/${k.id}`, "DELETE");
                          await load();
                        } catch (e) {
                          toast.error(errorText(e));
                        }
                      }}
                    >
                      撤销
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {!keys.length && (
        <p className="text-xs text-muted-foreground">
          创建第一个设备密钥，即可获取可复制的接入命令。
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        更新网页中的模型选择后，重复执行已保存的命令即可同步。撤销密钥会阻止后续请求。
      </p>
    </section>
  );
}
/** 网关账本视图：导航已下线，保留组件以便后续按需恢复。 */
export function Usage({
  me,
  generation,
  refresh,
}: {
  me: Me;
  generation: number;
  refresh: () => void;
}) {
  const [scope, setScope] = useState("mine"),
    [group, setGroup] = useState("day"),
    [range, setRange] = useState(30),
    [stats, setStats] = useState<{
      summary: Aggregate;
      groups: Aggregate[];
    } | null>(null),
    [rows, setRows] = useState<RequestRow[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [detail, setDetail] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const args = `scope=${scope}&group=${group}&from=${Math.floor(Date.now() / 1000) - range * 86400}`;
  useEffect(() => {
    let live = true;
    setBusy(true);
    void Promise.all([
      unit<typeof stats>(`/usage?${args}`),
      unit<{ data: RequestRow[]; total: number }>(
        `/requests?${args}&page=${page}`,
      ),
    ])
      .then(([s, logs]) => {
        if (live) {
          setStats(s);
          setRows(logs.data);
          setTotal(logs.total);
        }
      })
      .catch((e) => toast.error(errorText(e)))
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [scope, group, range, page, generation]);
  const s = stats?.summary;
  const exportStats = async () => {
    try {
      const data = await unit(`/usage/export?${args}`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "ccswitchuint-usage.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  return (
    <>
      <div className="u-page-title">
        <div>
          <h1>使用统计</h1>
          <p>
            统计来自网关实际请求。费用为估算；待核算请求的额度预留单独保留。
          </p>
        </div>
        <button className="u-quiet" onClick={() => void exportStats()}>
          导出统计
        </button>
      </div>
      <div className="u-toolbar">
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setPage(1);
          }}
        >
          <option value="mine">我的消费</option>
          <option value="provided">我提供的资源</option>
          {me.user.role === "admin" && <option value="all">平台全部</option>}
        </select>
        <select
          value={range}
          onChange={(e) => {
            setRange(Number(e.target.value));
            setPage(1);
          }}
        >
          <option value={1}>最近 24 小时</option>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={365}>最近一年</option>
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="day">按日期</option>
          <option value="model">按模型</option>
          <option value="provider">按供应商</option>
          <option value="device">按设备</option>
          <option value="user">按使用者</option>
        </select>
        {busy && <Busy />}
      </div>
      <div className="u-cards">
        <div className="u-card">
          <small>请求数</small>
          <strong>{num(s?.requests)}</strong>
        </div>
        <div className="u-card">
          <small>输入 / 输出 Token</small>
          <strong>
            {num(s?.input_tokens)} <span>/ {num(s?.output_tokens)}</span>
          </strong>
        </div>
        <div className="u-card">
          <small>估算费用</small>
          <strong>{dollars(s?.cost_credits ?? 0)}</strong>
          <small>{s?.unknown_cost || 0} 条费用未知</small>
        </div>
        <div className="u-card">
          <small>成功 / 待核算</small>
          <strong>
            {num(s?.successful)} <span>/ {num(s?.pending)}</span>
          </strong>
        </div>
      </div>
      <section className="u-panel">
        <div className="u-panel-title">
          用量分布 <small>按 UTC 归属账期</small>
        </div>
        <div className="u-table-wrap">
          <table>
            <thead>
              <tr>
                <th>分组</th>
                <th>请求</th>
                <th>输入 Token</th>
                <th>输出 Token</th>
                <th>缓存读取</th>
                <th>估算费用</th>
              </tr>
            </thead>
            <tbody>
              {stats?.groups.map((g) => (
                <tr key={g.label}>
                  <td>{g.label}</td>
                  <td>{num(g.requests)}</td>
                  <td>{num(g.input_tokens)}</td>
                  <td>{num(g.output_tokens)}</td>
                  <td>{num(g.cache_read_tokens)}</td>
                  <td>{dollars(g.cost_credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!stats?.groups.length && <Empty>此范围内还没有请求记录。</Empty>}
      </section>
      <section className="u-panel">
        <div className="u-panel-title">
          请求记录 <small>{num(total)} 条</small>
        </div>
        <div className="u-table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间 / 用户</th>
                <th>设备</th>
                <th>模型 / 供应商</th>
                <th>状态</th>
                <th>Token 输入 / 输出</th>
                <th>费用</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {date(r.created_at)}
                    <small>{r.username}</small>
                  </td>
                  <td>{r.device}</td>
                  <td>
                    <code>{r.request_model}</code>
                    <small>
                      {r.provider_name || "尚未路由"} · {r.owner_name || "—"}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`u-tag ${r.state === "completed" ? "u-green" : ""}`}
                    >
                      {messages[r.state] || r.state}
                    </span>
                    {r.error_code && <small>{r.error_code}</small>}
                  </td>
                  <td>
                    {num(r.input_tokens)} / {num(r.output_tokens)}
                  </td>
                  <td>{dollars(r.cost_credits)}</td>
                  <td>
                    <button
                      className="u-quiet"
                      onClick={() =>
                        void unit(`/requests/${r.id}`)
                          .then(setDetail)
                          .catch((e) => toast.error(errorText(e)))
                      }
                    >
                      详情
                    </button>
                    {me.user.role === "admin" &&
                      r.state === "pending_usage" && (
                        <button
                          className="u-quiet u-danger"
                          onClick={async () => {
                            try {
                              await unit(`/admin/reconcile/${r.id}`, "POST", {
                                input: 0,
                                output: 0,
                                read: 0,
                                write: 0,
                                releaseOnly: true,
                              });
                              refresh();
                            } catch (e) {
                              toast.error(errorText(e));
                            }
                          }}
                        >
                          释放预留
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="u-pagination">
          <button
            className="u-quiet"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </button>
          <span>
            {page} / {Math.max(1, Math.ceil(total / 30))}
          </span>
          <button
            className="u-quiet"
            disabled={page * 30 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      </section>
      {detail != null && (
        <Modal title="请求与上游尝试记录" close={() => setDetail(null)}>
          <pre className="u-detail">{JSON.stringify(detail, null, 2)}</pre>
        </Modal>
      )}
    </>
  );
}
function Profile({
  me,
  generation,
  loggedOut,
}: {
  me: Me;
  generation: number;
  loggedOut: () => void;
}) {
  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    void unit<ProfileOverview>("/profile/overview")
      .then((value) => {
        if (live) setOverview(value);
      })
      .catch((error) => toast.error(errorText(error)))
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [generation]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await unit("/password", "PUT", { currentPassword, newPassword });
      toast.success("密码已修改，请重新登录");
      loggedOut();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async () => {
    setDeleting(true);
    try {
      await unit("/account", "DELETE", { password: deletePassword });
      toast.success("账号已注销，感谢使用");
      loggedOut();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setDeleting(false);
    }
  };

  const usage = overview?.usage.usage || me.quota.usage;
  const budget = overview?.usage.budget || me.quota.budget;
  const remaining = remainingBudget(budget, usage);
  const owned = overview?.suppliers.filter((supplier) => supplier.owned) || [];
  const shared =
    overview?.suppliers.filter((supplier) => !supplier.owned) || [];

  const supplierSection = (
    title: string,
    description: string,
    suppliers: typeof owned,
    empty: string,
  ) => (
    <section className="u-panel">
      <div className="u-panel-title">
        <WalletCards size={17} />
        {title}
        <small>{suppliers.length} 个供应商</small>
      </div>
      <p className="u-section-description">{description}</p>
      {suppliers.length ? (
        <div className="u-supplier-grid">
          {suppliers.map((supplier) => (
            <article className="u-supplier-card" key={supplier.id}>
              <header>
                <div>
                  <h3>
                    {!supplier.owned && (
                      <>
                        <span className="font-medium text-primary">
                          {supplier.ownerName}
                        </span>
                        <span className="font-normal text-muted-foreground">
                          {" 的 "}
                        </span>
                      </>
                    )}
                    {supplier.name}
                  </h3>
                  <p>
                    {supplier.appType.toUpperCase()} ·{" "}
                    {supplier.owned ? "我的供应商" : "共享给我"}
                  </p>
                </div>
                <span className={`u-tag ${supplier.owned ? "u-green" : ""}`}>
                  {supplier.owned ? "自有" : "共享"}
                </span>
              </header>
              <div className="u-balance-grid">
                <div>
                  <small>
                    {supplier.balanceKind === "sharedPool"
                      ? `${periodName(supplier.period)}共享池预算`
                      : `${periodName(supplier.period)}分配额度`}
                  </small>
                  <strong>{budgetText(supplier.budget)}</strong>
                </div>
                <div>
                  <small>
                    {supplier.balanceKind === "sharedPool"
                      ? "共享池已用"
                      : "我的已用"}
                  </small>
                  <strong>
                    {budgetText({
                      requests: supplier.usage.requests ?? 0,
                      tokens: supplier.usage.tokens ?? 0,
                      credits: supplier.usage.credits ?? 0,
                    })}
                  </strong>
                </div>
                <div>
                  <small>进行中预留</small>
                  <strong>
                    {usageText(supplier.usage.reservedRequests)} 次 ·{" "}
                    {usageText(supplier.usage.reservedTokens)} Token
                  </strong>
                </div>
                <div>
                  <small>剩余可用</small>
                  <strong>{budgetText(supplier.remaining)}</strong>
                </div>
              </div>
              <footer>
                {supplier.balanceKind === "sharedPool" ? (
                  <span>包含所有共享用户，不含你自己的调用</span>
                ) : (
                  <>
                    <span>共享池预算：{budgetText(supplier.sharedBudget)}</span>
                    <span>
                      共享池已用：{usageText(supplier.sharedUsage.requests)} 次
                      · {usageText(supplier.sharedUsage.tokens)} Token
                    </span>
                  </>
                )}
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <Empty>{empty}</Empty>
      )}
    </section>
  );

  return (
    <>
      <div className="u-page-lead">
        <p>汇总你的个人平台额度，以及每个自有和共享供应商的剩余余额。</p>
        <span className="u-tag">
          {me.user.role === "admin" ? "管理员" : "普通用户"} ·{" "}
          {overview?.usage.periodKey || me.quota.periodKey} UTC
        </span>
      </div>
      <div className="u-cards">
        <div className="u-card">
          <small>本周期请求</small>
          <strong>
            {usageText(usage.requests)}{" "}
            <span>
              / {budget.requests == null ? "不限" : num(budget.requests)}
            </span>
          </strong>
          <small>
            预留 {usageText(usage.reservedRequests)} 次 · 剩余{" "}
            {remaining.requests == null ? "不限" : num(remaining.requests)}
          </small>
        </div>
        <div className="u-card">
          <small>本周期 Token</small>
          <strong>
            {usageText(usage.tokens)}{" "}
            <span>/ {budget.tokens == null ? "不限" : num(budget.tokens)}</span>
          </strong>
          <small>
            预留 {usageText(usage.reservedTokens)} · 剩余{" "}
            {remaining.tokens == null ? "不限" : num(remaining.tokens)}
          </small>
        </div>
        <div className="u-card">
          <small>本周期估算点数</small>
          <strong>
            {usageText(usage.credits)}{" "}
            <span>
              / {budget.credits == null ? "不限" : num(budget.credits)}
            </span>
          </strong>
          <small>
            {dollars(usage.credits || 0)} · 预留{" "}
            {usageText(usage.reservedCredits)}
          </small>
        </div>
        <div className="u-card">
          <small>可见供应商</small>
          <strong>
            {owned.length} <span>/ {shared.length}</span>
          </strong>
          <small>自有 / 共享给我</small>
        </div>
      </div>
      {loading && !overview ? (
        <Empty>
          <Busy />
        </Empty>
      ) : (
        <>
          {supplierSection(
            "我的供应商余额",
            "你提供的资源及本周期使用情况",
            owned,
            "还没有自己的供应商。",
          )}
          {supplierSection(
            "共享给我的供应商",
            "由其他用户分配或通过分享口令领取",
            shared,
            "当前没有他人共享给你的供应商。",
          )}
        </>
      )}
      <section className="u-panel">
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger asChild>
            <button type="button" className="u-panel-title w-full text-left">
              <ChevronDown className="u-collapsible-icon h-4 w-4" />
              <span>账号与安全</span>
              <small>修改密码</small>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <form className="u-panel-body u-narrow" onSubmit={submit}>
              <Field label="当前密码">
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </Field>
              <Field label="新密码">
                <input
                  required
                  type="password"
                  minLength={8}
                  maxLength={256}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNew(e.target.value)}
                />
              </Field>
              <button className="u-button" disabled={busy}>
                修改密码并退出所有网页会话
              </button>
            </form>
          </CollapsibleContent>
        </Collapsible>
      </section>
      <section className="u-panel">
        <div className="u-panel-title">
          <Trash2 size={17} />
          注销账号
          <small>删除个人数据并停用账号</small>
        </div>
        <div className="u-panel-body u-narrow">
          {me.user.role === "admin" ? (
            <p className="u-note">
              管理员账号不能自助注销。如果需要停用，请先在“用户与额度”里把权限移交给其他账号。
            </p>
          ) : (
            <>
              <p className="u-note">
                注销会删除你的供应商、授权、申请记录、API
                密钥与登录态，操作不可恢复。注销前需要验证当前密码。
              </p>
              <Field label="当前密码">
                <input
                  type="password"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                />
              </Field>
              {confirmDelete ? (
                <div className="u-actions">
                  <span className="u-note">确认注销？该操作不可恢复。</span>
                  <button
                    type="button"
                    className="u-button u-danger"
                    disabled={deleting}
                    onClick={() => void removeAccount()}
                  >
                    {deleting ? <Busy /> : "确认注销"}
                  </button>
                  <button
                    type="button"
                    className="u-quiet"
                    disabled={deleting}
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="u-button u-danger"
                  disabled={!deletePassword}
                  onClick={() => setConfirmDelete(true)}
                >
                  注销我的账号
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}
function Admin({
  generation,
  refresh,
}: {
  generation: number;
  refresh: () => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]),
    [editing, setEditing] = useState<UserRow | null>(null),
    [settings, setSettings] = useState({
      registration: "open",
      publicUrl: "",
      publicProxyUrl: "",
    }),
    [auditRows, setAudit] = useState<
      Array<{
        id: string;
        username?: string;
        action: string;
        target: string;
        created_at: number;
      }>
    >([]);
  const load = useCallback(async () => {
    const [u, s, a] = await Promise.all([
      unit<UserRow[]>("/admin/users"),
      unit<typeof settings>("/admin/settings"),
      unit<typeof auditRows>("/admin/audit"),
    ]);
    setUsers(u);
    setSettings(s);
    setAudit(a);
  }, []);
  useEffect(() => {
    void load().catch((e) => toast.error(errorText(e)));
  }, [load, generation]);
  return (
    <>
      <div className="u-page-lead">
        <p>
          管理用户额度、注册和公开接入地址。资源提供者仍自行管理入池和分配。
        </p>
        <span className="text-xs text-muted-foreground">
          监听与出站代理由服务端部署配置管理。
        </span>
      </div>
      <section className="u-panel">
        <div className="u-panel-title">
          <Users size={17} />
          用户与平台额度
        </div>
        <div className="u-table-wrap">
          <table>
            <thead>
              <tr>
                <th>用户</th>
                <th>状态</th>
                <th>平台周期额度</th>
                <th>限流</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const b = JSON.parse(u.budget) as Budget;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.username}
                      <small>{u.role}</small>
                    </td>
                    <td>{u.active ? "启用" : "停用"}</td>
                    <td>
                      {b.requests ?? "不限"} 次 / {b.tokens ?? "不限"} token
                    </td>
                    <td>
                      {u.rpm} RPM · {u.concurrency} 并发
                    </td>
                    <td>
                      <button className="u-quiet" onClick={() => setEditing(u)}>
                        管理
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="u-panel u-resource">
        <h2>注册与接入</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await unit("/admin/settings", "PUT", settings);
              toast.success("设置已保存");
              refresh();
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        >
          <Field label="用户注册">
            <select
              value={settings.registration}
              onChange={(e) =>
                setSettings({ ...settings, registration: e.target.value })
              }
            >
              <option value="open">开放注册</option>
              <option value="closed">关闭注册</option>
            </select>
          </Field>
          <div className="u-grid2">
            <Field label="网页公开地址">
              <input
                required
                type="url"
                value={settings.publicUrl}
                onChange={(e) =>
                  setSettings({ ...settings, publicUrl: e.target.value })
                }
              />
            </Field>
            <Field label="模型代理公开地址">
              <input
                required
                type="url"
                value={settings.publicProxyUrl}
                onChange={(e) =>
                  setSettings({ ...settings, publicProxyUrl: e.target.value })
                }
              />
            </Field>
          </div>
          <button className="u-button">保存设置</button>
        </form>
      </section>
      <section className="u-panel">
        <div className="u-panel-title">最近管理操作</div>
        <div className="u-table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>操作</th>
                <th>对象</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.slice(0, 30).map((a) => (
                <tr key={a.id}>
                  <td>{date(a.created_at)}</td>
                  <td>{a.username}</td>
                  <td>{a.action}</td>
                  <td>
                    <code>{a.target}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && (
        <UserEditor
          value={editing}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            void load();
            refresh();
          }}
        />
      )}
    </>
  );
}
function UserEditor({
  value,
  close,
  saved,
}: {
  value: UserRow;
  close: () => void;
  saved: () => void;
}) {
  const [budget] = useState<Budget>(JSON.parse(value.budget)),
    [active, setActive] = useState(!!value.active),
    [period] = useState(value.period),
    [rpm, setRpm] = useState(value.rpm),
    [concurrency, setConcurrency] = useState(value.concurrency),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={`管理用户 · ${value.username}`} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await unit(`/admin/users/${value.id}`, "PUT", {
              active,
              budget,
              period,
              rpm,
              concurrency,
              newPassword: password || null,
            });
            saved();
          } catch (e) {
            toast.error(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="u-grid2">
          <Field label="用户状态">
            <select
              value={String(active)}
              onChange={(e) => setActive(e.target.value === "true")}
            >
              <option value="true">启用</option>
              <option value="false">停用</option>
            </select>
          </Field>
        </div>
        <div className="u-grid2">
          <Field label="每分钟请求上限（0 = 不限）">
            <input
              type="number"
              min={0}
              max={10000}
              value={rpm}
              onChange={(e) => setRpm(Number(e.target.value))}
            />
          </Field>
          <Field label="并发请求上限（0 = 不限）">
            <input
              type="number"
              min={0}
              max={1000}
              value={concurrency}
              onChange={(e) => setConcurrency(Number(e.target.value))}
            />
          </Field>
        </div>
        {value.role !== "legacy" && (
          <Field label="重置密码（留空不修改）">
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}
        <div className="u-actions">
          <span className="u-spacer" />
          <button type="button" className="u-quiet" onClick={close}>
            取消
          </button>
          <button className="u-button" disabled={busy}>
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}
