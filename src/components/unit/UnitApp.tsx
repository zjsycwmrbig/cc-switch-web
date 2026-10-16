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
  Boxes,
  ChevronDown,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  Plus,
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
import { AggregationSyncPanel } from "@/components/providers/AggregationSyncPanel";
import {
  unit,
  Budget,
  Usage as UsageNumbers,
  Policy,
  defaultPolicy,
  Resource,
  Me,
  Preferences,
  Model,
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
}: {
  value: Budget;
  change: (b: Budget) => void;
  title: string;
}) {
  return (
    <fieldset className="u-budget">
      <legend>{title}</legend>
      <div className="u-grid3">
        {(
          [
            ["requests", "请求次数"],
            ["tokens", "Token 数量"],
            ["credits", "点数"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              type="number"
              min={0}
              step={1}
              placeholder="不限"
              value={value[key] ?? ""}
              onChange={(e) =>
                change({
                  ...value,
                  [key]: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </Field>
        ))}
      </div>
      <small>
        留空表示不限，0 表示没有额度。1,000,000 点对应 $1 估算成本。
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
function budgetText(value: Budget): string {
  return [
    value.requests == null ? null : `${num(value.requests)} 次`,
    value.tokens == null ? null : `${num(value.tokens)} Token`,
    value.credits == null ? null : `${num(value.credits)} 点`,
  ]
    .filter(Boolean)
    .join(" / ") || "不限";
}
function remainingBudget(budget: Budget, usage: UsageNumbers): Budget {
  const left = (
    limit: number | null | undefined,
    used: number | undefined,
    held: number | undefined,
  ) =>
    limit == null
      ? null
      : Math.max(0, limit - (used || 0) - (held || 0));
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
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
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
  page: "models" | "allocations" | "profile" | "admin" | "ledger";
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
    <div className="unit-content mx-auto w-full max-w-6xl px-6 py-4">
      {page === "models" && <Models me={me} generation={generation} />}
      {page === "allocations" && <Allocations generation={generation} />}
      {page === "profile" && (
        <Profile
          me={me}
          generation={generation}
          loggedOut={reset}
        />
      )}
      {page === "admin" && me.user.role === "admin" && (
        <Admin generation={generation} refresh={refresh} />
      )}
      {page === "ledger" && (
        <Usage me={me} generation={generation} refresh={refresh} />
      )}
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
function Models({ me, generation }: { me: Me; generation: number }) {
  const [models, setModels] = useState<Model[]>([]),
    [prefs, setPrefs] = useState<Preferences>({}),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(true),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    setBusy(true);
    void Promise.all([
      unit<{ models: Model[] }>("/catalog?all=true"),
      unit<Preferences>("/preferences"),
    ])
      .then(([catalog, p]) => {
        if (!live) return;
        setModels(catalog.models);
        setPrefs(p);
        setSelected(new Set(p.models ?? catalog.models.map((m) => m.slug)));
      })
      .catch((e) => toast.error(errorText(e)))
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [generation]);
  const save = async () => {
    setSaving(true);
    try {
      const ids = [...selected].filter((id) =>
        models.some((m) => m.slug === id),
      );
      await unit("/preferences", "PUT", {
        ...prefs,
        models: ids,
        startupModel: ids.includes(prefs.startupModel || "")
          ? prefs.startupModel
          : ids[0],
      });
      toast.success("已保存；在远程主机执行设备更新命令即可同步");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const visible = models.filter((m) =>
    `${m.slug} ${m.display_name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="u-page-title">
        <div>
          <h1>模型与接入</h1>
          <p>
            选择可用模型，创建设备密钥，并获取聚合模型同步命令。官方共享账号池会在可用账号间调度。
          </p>
        </div>
        <button
          className="u-button"
          disabled={saving || busy}
          onClick={() => void save()}
        >
          {saving ? <Busy /> : "保存选择"}
        </button>
      </div>
      <div className="u-cards">
        <div className="u-card">
          <small>可选模型</small>
          <strong>{models.length}</strong>
        </div>
        <div className="u-card">
          <small>已选择</small>
          <strong>{selected.size}</strong>
        </div>
        <div className="u-card u-wide">
          <small>本周期调用 / 额度</small>
          <strong>
            {num(me.quota.usage.requests)}{" "}
            <span>
              /{" "}
              {me.quota.budget.requests == null
                ? "不限"
                : num(me.quota.budget.requests)}
            </span>
          </strong>
          <small>
            预留 {num(me.quota.usage.reservedRequests)} 次 ·{" "}
            {me.quota.periodKey} UTC
          </small>
        </div>
      </div>
      <Collapsible defaultOpen={false} className="u-panel">
        <CollapsibleTrigger asChild>
          <button type="button" className="u-panel-title w-full text-left">
            <ChevronDown className="u-collapsible-icon h-4 w-4 shrink-0" />
            <span>模型选择</span>
            <small>
              已选择 {selected.size} / {models.length}
            </small>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="u-toolbar">
            <div className="u-search">
              <Search size={15} />
              <input
                placeholder="搜索模型或供应商"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              className="u-quiet"
              onClick={() => setSelected(new Set(models.map((m) => m.slug)))}
            >
              全选
            </button>
            <button className="u-quiet" onClick={() => setSelected(new Set())}>
              清空
            </button>
            <span className="u-spacer" />
            <label className="u-inline">
              启动模型
              <select
                value={prefs.startupModel || ""}
                onChange={(e) =>
                  setPrefs({ ...prefs, startupModel: e.target.value })
                }
              >
                <option value="">第一个已选模型</option>
                {models
                  .filter((m) => selected.has(m.slug))
                  .map((m) => (
                    <option key={m.slug} value={m.slug}>
                      {m.display_name || m.slug}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {busy ? (
            <Empty>
              <Busy />
            </Empty>
          ) : visible.length ? (
            <div className="u-model-list">
              {visible.map((m) => (
                <label className="u-model" key={m.slug}>
                  <input
                    type="checkbox"
                    checked={selected.has(m.slug)}
                    onChange={() =>
                      setSelected((old) => {
                        const next = new Set(old);
                        if (next.has(m.slug)) next.delete(m.slug);
                        else next.add(m.slug);
                        return next;
                      })
                    }
                  />
                  <div>
                    <strong>{m.display_name || m.slug}</strong>
                    <code>{m.slug}</code>
                  </div>
                  {m.context_window && (
                    <span className="u-tag">
                      {num(m.context_window / 1000)}K
                    </span>
                  )}
                </label>
              ))}
            </div>
          ) : (
            <Empty>暂无可选模型。请添加供应商，或联系提供者授权。</Empty>
          )}
        </CollapsibleContent>
      </Collapsible>
      <AggregationSyncPanel />
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
type UsageBucket = Record<string, string | number>;

function Allocations({ generation }: { generation: number }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<"grants" | "codes">("grants");
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [buckets, setBuckets] = useState<UsageBucket[]>([]);
  const [codes, setCodes] = useState<ShareCode[]>([]);
  const [createdCode, setCreatedCode] = useState<ShareCode | null>(null);
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

  const selected = resources.find((resource) => resource.id === selectedId);
  const selectedCodes = codes.filter((code) => code.resourceId === selectedId);

  const loadResources = useCallback(async () => {
    const [all, shareCodes] = await Promise.all([
      unit<Resource[]>("/resources"),
      unit<ShareCode[]>("/share-codes"),
    ]);
    const owned = all.filter((resource) => resource.owned && !resource.disabled);
    setResources(owned);
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
      setBuckets([]);
      return;
    }
    const [grantRows, usageBuckets] = await Promise.all([
      unit<GrantRow[]>(`/resources/${selectedId}/grants`),
      unit<UsageBucket[]>(`/resources/${selectedId}/usage`),
    ]);
    setGrants(grantRows);
    setBuckets(usageBuckets);
  }, [selectedId]);

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
      setBuckets([]);
      return;
    }
    void loadDetails().catch((error) => {
      if (live) toast.error(errorText(error));
    });
    return () => {
      live = false;
    };
  }, [generation, loadDetails, selectedId]);

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
      toast.success("分享口令已创建，请在离开前复制链接");
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
  ) => (
    <div className="u-model-picker" aria-label="允许的模型">
      {selected?.models.map((model) => {
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

  return (
    <>
      <div className="u-page-title">
        <div>
          <h1>额度分配</h1>
          <p>
            在这里集中管理自己的供应商。指定用户模式适合长期协作，分享口令模式适合先到先得地发放额度。
          </p>
        </div>
      </div>
      {busy ? (
        <Empty>
          <Busy />
        </Empty>
      ) : !resources.length ? (
        <Empty>
          还没有可分配的供应商。请先在“我的供应商”中创建、发布并启用资源。
        </Empty>
      ) : (
        <div className="u-allocation-layout">
          <aside className="u-allocation-list">
            <div className="u-allocation-list-head">
              <strong>我的供应商</strong>
              <span>{resources.length}</span>
            </div>
            {resources.map((resource) => (
              <button
                key={resource.id}
                type="button"
                className={`u-allocation-item ${
                  resource.id === selectedId ? "active" : ""
                }`}
                onClick={() => {
                  setSelectedId(resource.id);
                  resetGrantForm();
                }}
              >
                <span>{resource.name}</span>
                <small>
                  {resource.appType.toUpperCase()} ·{" "}
                  {resource.published ? "已发布" : "未发布"}
                </small>
              </button>
            ))}
          </aside>
          {selected && (
            <section className="u-allocation-main">
              <div className="u-allocation-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p>
                    {periodName(selected.policy?.period || "month")}结算 ·{" "}
                    {selected.models.length} 个模型 · 路由{" "}
                    <code>{selected.routeKey}</code>
                  </p>
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
                  aria-selected={mode === "grants"}
                  className={mode === "grants" ? "active" : ""}
                  onClick={() => setMode("grants")}
                >
                  <Users size={15} />
                  指定用户
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
              </div>

              {mode === "grants" ? (
                <>
                  <section className="u-panel">
                    <div className="u-panel-title">
                      <Users size={17} />
                      共享规则
                      <small>
                        指定用户分配会覆盖下方的公开默认额度
                      </small>
                    </div>
                    <form className="u-panel-body" onSubmit={savePolicy}>
                      <div className="u-grid2">
                        <Field label="共享范围">
                          <select
                            value={policy.visibility}
                            onChange={(event) =>
                              setPolicy({
                                ...policy,
                                visibility: event.target.value,
                              })
                            }
                          >
                            <option value="public">所有注册用户</option>
                            <option value="selected">仅指定用户</option>
                            <option value="private">仅自己</option>
                          </select>
                        </Field>
                        <Field label="额度周期（UTC）">
                          <select
                            value={policy.period}
                            onChange={(event) =>
                              setPolicy({
                                ...policy,
                                period: event.target.value,
                              })
                            }
                          >
                            <option value="month">每月</option>
                            <option value="day">每天</option>
                            <option value="lifetime">累计</option>
                          </select>
                        </Field>
                      </div>
                      <BudgetFields
                        title="其他用户的默认额度"
                        value={policy.defaultBudget}
                        change={(value) =>
                          setPolicy({ ...policy, defaultBudget: value })
                        }
                      />
                      <BudgetFields
                        title="所有共享用户的合计预算"
                        value={policy.sharedBudget}
                        change={(value) =>
                          setPolicy({ ...policy, sharedBudget: value })
                        }
                      />
                      <Field label="共享范围允许的模型（留空为全部）">
                        {modelPicker(policy.models, (value) =>
                          setPolicy({ ...policy, models: value }),
                        )}
                      </Field>
                      <button
                        className="u-button"
                        disabled={saving}
                        type="submit"
                      >
                        {saving ? <Busy /> : "保存共享规则"}
                      </button>
                    </form>
                  </section>

                  <section className="u-panel">
                    <div className="u-panel-title">
                      <UserPlus size={17} />
                      指定用户
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
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {grants.map((row) => {
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
                                          ? new Date(
                                              row.expires_at * 1000,
                                            )
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
                    {!grants.length && (
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
                          {modelPicker(grantModels, setGrantModels)}
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

                  {buckets.length > 0 && (
                    <section className="u-panel">
                      <Collapsible defaultOpen={false}>
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="u-panel-title w-full text-left"
                          >
                            <ChevronDown className="u-collapsible-icon h-4 w-4" />
                            <span>额度账本用量</span>
                            <small>预留与已结算明细</small>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="u-table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>范围与账期</th>
                                  <th>已用请求</th>
                                  <th>已用 Token</th>
                                  <th>预留请求</th>
                                </tr>
                              </thead>
                              <tbody>
                                {buckets.map((bucket) => (
                                  <tr key={String(bucket.id)}>
                                    <td>
                                      <code>{bucket.id}</code>
                                    </td>
                                    <td>{bucket.used_requests}</td>
                                    <td>{bucket.used_tokens}</td>
                                    <td>{bucket.reserved_requests}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </section>
                  )}
                </>
              ) : (
                <>
                  {createdCode?.url && (
                    <div className="u-created u-created-panel">
                      <div>
                        <h2>分享口令已创建</h2>
                        <p>
                          此链接只显示一次。接收者登录后会自动领取，额度按先到先得结算。
                        </p>
                      </div>
                      <code>{createdCode.url}</code>
                      <div className="u-actions">
                        <button
                          type="button"
                          className="u-button"
                          onClick={() => void copy(createdCode.url!)}
                        >
                          <Link2 size={14} />
                          复制分享链接
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
                      />
                      <div className="u-grid2">
                        <Field label="允许的模型（留空为全部）">
                          {modelPicker(codeModels, setCodeModels)}
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
                            const active = code.active && !exhausted && !expired;
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
                                        复制链接
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
                    {!selectedCodes.length && (
                      <Empty>还没有分享口令。</Empty>
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
    <section className="u-panel">
      <div className="u-panel-title">
        <span>设备与接入密钥</span>
        <small>
          为每台主机创建独立密钥，用量归入你的账号，也能按设备查看。
        </small>
      </div>
      <form className="u-toolbar" onSubmit={create}>
        <input
          required
          maxLength={100}
          placeholder="设备名称，例如 moss、nccl5"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="u-button" disabled={busy}>
          <Plus size={15} />
          创建设备密钥
        </button>
      </form>
      {created && (
        <div className="u-created">
          <h2>复制到远程主机执行</h2>
          <p>
            密钥明文仅在本次显示。命令会备份配置、写入个人路由和模型目录，并尝试重启
            Codex app-server。
          </p>
          <pre>{created.command}</pre>
          <div className="u-actions">
            <button
              className="u-button"
              onClick={() => void copy(created.command)}
            >
              <Copy size={14} />
              复制接入 / 更新命令
            </button>
            <button className="u-quiet" onClick={() => void copy(created.key)}>
              复制 API Key
            </button>
            <button className="u-quiet" onClick={() => setCreated(null)}>
              隐藏
            </button>
          </div>
        </div>
      )}
      <div className="u-table-wrap">
        <table>
          <thead>
            <tr>
              <th>设备</th>
              <th>密钥前缀</th>
              <th>最近使用</th>
              <th>状态</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>{k.prefix}…</code>
                </td>
                <td>{date(k.last_used_at)}</td>
                <td>{k.active ? "启用" : "已撤销"}</td>
                <td>
                  {!!k.active && (
                    <button
                      className="u-quiet u-danger"
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
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!keys.length && (
        <Empty>创建第一个设备密钥，即可获取可复制的接入命令。</Empty>
      )}
      <p className="u-note px-4 pb-2">
        更新网页中的模型选择后，重复执行已保存的命令即可同步。撤销密钥会阻止后续请求。
      </p>
    </section>
  );
}
function Usage({
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
                  <h3>{supplier.name}</h3>
                  <p>
                    {supplier.appType.toUpperCase()} ·{" "}
                    {supplier.owned
                      ? "我的供应商"
                      : `共享自 ${supplier.ownerName}`}
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
                  <span>
                    包含所有共享用户，不含你自己的调用
                  </span>
                ) : (
                  <>
                    <span>
                      共享池预算：{budgetText(supplier.sharedBudget)}
                    </span>
                    <span>
                      共享池已用：{usageText(supplier.sharedUsage.requests)} 次 ·{" "}
                      {usageText(supplier.sharedUsage.tokens)} Token
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
      <div className="u-page-title">
        <div>
          <h1>个人用量 · {me.user.username}</h1>
          <p>
            汇总你的个人平台额度，以及每个自有和共享供应商的剩余余额。
          </p>
        </div>
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
      <div className="u-page-title">
        <div>
          <h1>平台管理</h1>
          <p>
            管理用户额度、注册和公开接入地址。资源提供者仍自行管理入池和分配。
          </p>
        </div>
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
  const [budget, setBudget] = useState<Budget>(JSON.parse(value.budget)),
    [active, setActive] = useState(!!value.active),
    [period, setPeriod] = useState(value.period),
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
          <Field label="额度周期">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="month">每月</option>
              <option value="day">每天</option>
              <option value="lifetime">累计</option>
            </select>
          </Field>
        </div>
        <BudgetFields
          title="个人平台额度（所有设备合计）"
          value={budget}
          change={setBudget}
        />
        <div className="u-grid2">
          <Field label="每分钟请求上限">
            <input
              type="number"
              min={1}
              max={10000}
              value={rpm}
              onChange={(e) => setRpm(Number(e.target.value))}
            />
          </Field>
          <Field label="并发请求上限">
            <input
              type="number"
              min={1}
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
