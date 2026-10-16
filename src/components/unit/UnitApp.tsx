import { copyText } from "@/lib/clipboard";
import { setWebUserRole } from "@/lib/runtime/client/web";
import {
  FormEvent,
  ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Boxes, Copy, LoaderCircle, Plus, Search, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  unit,
  Budget,
  Policy,
  defaultPolicy,
  Resource,
  Me,
  Preferences,
  Model,
  ApiKey,
  Aggregate,
  RequestRow,
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

export default function UnitApp() {
  const query = useQueryClient();
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
  page: "models" | "keys" | "profile" | "admin" | "ledger";
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
      {page === "keys" && <Keys generation={generation} />}
      {page === "profile" && <Profile me={me} loggedOut={reset} />}
      {page === "admin" && me.user.role === "admin" && (
        <Admin generation={generation} refresh={refresh} />
      )}
      {page === "ledger" && (
        <Usage me={me} generation={generation} refresh={refresh} />
      )}
    </div>
  );
}
export function ProviderSharing({
  resource,
  close,
}: {
  resource: Resource;
  close: () => void;
}) {
  return <Sharing resource={resource} close={close} />;
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
          <h1>你的模型目录</h1>
          <p>从获授权的供应商中选择模型。官方共享账号池会在可用账号间调度。</p>
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
      <section className="u-panel">
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
                  <span className="u-tag">{num(m.context_window / 1000)}K</span>
                )}
              </label>
            ))}
          </div>
        ) : (
          <Empty>暂无可选模型。请添加供应商，或联系提供者授权。</Empty>
        )}
      </section>
      <p className="u-note">
        保存后，在“设备与密钥”创建设备密钥并复制接入命令。后续重复执行同一命令，会备份并同步你的最新模型选择。
      </p>
    </>
  );
}
function Sharing({
  resource,
  close,
}: {
  resource: Resource;
  close: () => void;
}) {
  const [policy, setPolicy] = useState<Policy>(
    resource.policy || defaultPolicy(),
  );
  const savePolicy = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await unit(`/resources/${resource.id}/policy`, "PUT", policy);
      toast.success("共享范围与默认额度已保存");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const [rows, setRows] = useState<
      Array<{
        username: string;
        allowed: number;
        budget: string;
        models: string;
        expires_at?: number;
      }>
    >([]),
    [username, setUsername] = useState(""),
    [allowed, setAllowed] = useState(true),
    [budget, setBudget] = useState<Budget>({}),
    [models, setModels] = useState(""),
    [expires, setExpires] = useState(""),
    [busy, setBusy] = useState(false),
    [buckets, setBuckets] = useState<Array<Record<string, string | number>>>(
      [],
    );
  const load = useCallback(async () => {
    const [grants, usage] = await Promise.all([
      unit<typeof rows>(`/resources/${resource.id}/grants`),
      unit<typeof buckets>(`/resources/${resource.id}/usage`),
    ]);
    setRows(grants);
    setBuckets(usage);
  }, [resource.id]);
  useEffect(() => {
    void load().catch((e) => toast.error(errorText(e)));
  }, [load]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await unit(`/resources/${resource.id}/grants`, "PUT", {
        username,
        allowed,
        budget,
        models: models
          .split(/\n|,/)
          .map((s) => s.trim())
          .filter(Boolean),
        expiresAt: expires
          ? Math.floor(new Date(expires).getTime() / 1000)
          : null,
      });
      await load();
      toast.success("用户分配已保存");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`${resource.name} · 分配与用量`} close={close}>
      <p className="u-note">
        单独分配会覆盖公开默认额度。提供者本人的分配额度默认不限。
      </p>
      <form onSubmit={savePolicy} className="space-y-4 rounded-lg border p-4">
        <div className="u-grid2">
          <Field label="共享范围">
            <select
              value={policy.visibility}
              onChange={(e) =>
                setPolicy({ ...policy, visibility: e.target.value })
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
              onChange={(e) => setPolicy({ ...policy, period: e.target.value })}
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
          change={(b) => setPolicy({ ...policy, defaultBudget: b })}
        />
        <BudgetFields
          title="所有共享用户的合计预算"
          value={policy.sharedBudget}
          change={(b) => setPolicy({ ...policy, sharedBudget: b })}
        />
        <button className="u-button" disabled={busy}>
          保存共享规则
        </button>
      </form>
      <h3 className="text-sm font-medium">按用户单独分配</h3>
      <div className="u-table-wrap">
        <table>
          <thead>
            <tr>
              <th>用户</th>
              <th>权限</th>
              <th>单独额度</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.username}>
                <td>{r.username}</td>
                <td>{r.allowed ? "允许" : "禁用"}</td>
                <td>
                  {(() => {
                    const b = JSON.parse(r.budget) as Budget;
                    return `${b.requests ?? "不限"} 次 / ${b.tokens ?? "不限"} token`;
                  })()}
                </td>
                <td>
                  <button
                    className="u-quiet"
                    onClick={() => {
                      setUsername(r.username);
                      setAllowed(!!r.allowed);
                      setBudget(JSON.parse(r.budget));
                      setModels(JSON.parse(r.models).join("\n"));
                      setExpires(
                        r.expires_at
                          ? new Date(r.expires_at * 1000)
                              .toISOString()
                              .slice(0, 16)
                          : "",
                      );
                    }}
                  >
                    编辑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={save}>
        <div className="u-grid2">
          <Field label="平台用户名">
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field label="授权">
            <select
              value={String(allowed)}
              onChange={(e) => setAllowed(e.target.value === "true")}
            >
              <option value="true">允许使用</option>
              <option value="false">禁用此用户</option>
            </select>
          </Field>
        </div>
        <BudgetFields
          title="此用户的独立额度"
          value={budget}
          change={setBudget}
        />
        <div className="u-grid2">
          <Field label="允许的模型（留空为全部）">
            <textarea
              rows={2}
              value={models}
              onChange={(e) => setModels(e.target.value)}
            />
          </Field>
          <Field label="到期时间（可留空）">
            <input
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
        </div>
        <button className="u-button" disabled={busy}>
          保存用户分配
        </button>
      </form>
      {buckets.length > 0 && (
        <details>
          <summary>额度账本用量</summary>
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
                {buckets.map((b) => (
                  <tr key={String(b.id)}>
                    <td>
                      <code>{b.id}</code>
                    </td>
                    <td>{b.used_requests}</td>
                    <td>{b.used_tokens}</td>
                    <td>{b.reserved_requests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Modal>
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
    <>
      <div className="u-page-title">
        <div>
          <h1>设备与接入密钥</h1>
          <p>为每台主机创建独立密钥，用量归入你的账号，也能按设备查看。</p>
        </div>
      </div>
      <section className="u-panel">
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
              <button
                className="u-quiet"
                onClick={() => void copy(created.key)}
              >
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
      </section>
      <p className="u-note">
        更新网页中的模型选择后，重复执行已保存的命令即可同步。撤销密钥会阻止后续请求。
      </p>
    </>
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
function Profile({ me, loggedOut }: { me: Me; loggedOut: () => void }) {
  const [currentPassword, setCurrent] = useState(""),
    [newPassword, setNew] = useState(""),
    [busy, setBusy] = useState(false);
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
  return (
    <>
      <div className="u-page-title">
        <div>
          <h1>{me.user.username}</h1>
          <p>账号额度与登录设置。</p>
        </div>
      </div>
      <section className="u-panel u-resource">
        <h2>本周期额度 · {me.quota.periodKey}</h2>
        <div className="u-grid3">
          {(
            [
              ["requests", "调用次数"],
              ["tokens", "Token"],
              ["credits", "点数"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <small>{label}</small>
              <p>
                {num(me.quota.usage[key])} /{" "}
                {me.quota.budget[key] == null
                  ? "不限"
                  : num(me.quota.budget[key]!)}
              </p>
            </div>
          ))}
        </div>
        <small>
          额度由管理员分配；供应商还可以设置独立的使用额度。账期按 UTC 计算。
        </small>
      </section>
      <section className="u-panel u-resource">
        <h2>修改密码</h2>
        <form className="u-narrow" onSubmit={submit}>
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
          服务器设置位于原“设置 → 代理”页面。
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
