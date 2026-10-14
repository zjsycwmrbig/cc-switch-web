import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { Provider } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { providersApi } from "@/lib/api/providers";
import { sortProvidersByName } from "@/utils/providerSort";
import {
  downloadWebModelFile,
  fetchWebClientModelPool,
  getWebAccessKey,
  getWebApiBase,
  saveWebClientModelPool,
  type WebClientModelPool,
} from "@/lib/runtime/client/web";

/**
 * 模型匹配池。
 *
 * 左侧是「全部供应商模型池」：所有 Codex 供应商的模型目录、默认模型和映射键的并集，
 * 也就是要导出给远程主机当客户端模型清单的那份列表，在这里增删再导出。
 * 右侧只看当前选中的供应商：默认模型、模型目录，以及显式的
 * 「客户端请求模型 → 实际转发模型」映射。
 *
 * 真正的解析顺序以后端
 * `backend/src/proxy/providers/codex.rs::apply_codex_native_upstream_model` 为准：
 * 显式映射 → 档位别名 → 供应商模型目录命中 → 原样透传（目录为空）→ 回落供应商默认模型。
 */

const BASE_ALIASES = ["cc-auto", "cc-switch-auto"];

type RuleKey =
  | "mapping"
  | "alias"
  | "catalog"
  | "passthrough"
  | "fallback"
  | "missing";

const RULE_LABEL: Record<RuleKey, string> = {
  mapping: "显式映射",
  alias: "档位别名",
  catalog: "目录命中",
  passthrough: "原样透传",
  fallback: "回落默认",
  missing: "无默认模型",
};

const RULE_CLASS: Record<RuleKey, string> = {
  mapping: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  alias: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  catalog: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  passthrough: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  fallback: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  missing: "bg-muted text-muted-foreground",
};

interface Resolved {
  model: string;
  rule: RuleKey;
}

function settingsConfigOf(provider: Provider): Record<string, any> {
  const raw = provider.settingsConfig;
  return raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
}

function defaultModelOf(provider: Provider): string {
  const config = settingsConfigOf(provider);
  const direct = typeof config.model === "string" ? config.model.trim() : "";
  if (direct) return direct;
  const text = typeof config.config === "string" ? config.config : "";
  const matched = text.match(/^[ \t]*model[ \t]*=[ \t]*"([^"]*)"/m);
  return matched ? matched[1].trim() : "";
}

function catalogModelsOf(provider: Provider): string[] {
  const catalog = settingsConfigOf(provider).modelCatalog;
  const models = catalog && typeof catalog === "object" ? catalog.models : null;
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  models.forEach((item: any) => {
    const name = typeof item?.model === "string" ? item.model.trim() : "";
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    names.push(name);
  });
  return names;
}

function mappingOf(provider: Provider): Record<string, string> {
  const raw = settingsConfigOf(provider).modelMapping;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(
      ([from, to]) =>
        [from.trim(), typeof to === "string" ? to.trim() : ""] as const,
    )
    .filter(
      ([from, to]) =>
        from.length > 0 &&
        to.length > 0 &&
        from.toLowerCase() !== to.toLowerCase(),
    );
  return Object.fromEntries(entries);
}

function resolveModel(provider: Provider, requestModel: string): Resolved {
  const mapping = mappingOf(provider);
  const mapped = Object.entries(mapping).find(
    ([from]) => from.toLowerCase() === requestModel.toLowerCase(),
  );
  if (mapped) return { model: mapped[1], rule: "mapping" };

  const isAlias = BASE_ALIASES.some(
    (alias) => alias.toLowerCase() === requestModel.toLowerCase(),
  );
  const catalog = catalogModelsOf(provider);
  if (!isAlias) {
    if (catalog.some((model) => model.toLowerCase() === requestModel.toLowerCase())) {
      return { model: requestModel, rule: "catalog" };
    }
    if (catalog.length === 0) {
      return { model: requestModel, rule: "passthrough" };
    }
  }

  const fallback = defaultModelOf(provider);
  if (!fallback) {
    return { model: requestModel, rule: isAlias ? "alias" : "missing" };
  }
  return { model: fallback, rule: isAlias ? "alias" : "fallback" };
}

function RuleBadge({ rule }: { rule: RuleKey }) {
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${RULE_CLASS[rule]}`}
    >
      {RULE_LABEL[rule]}
    </span>
  );
}

export interface ModelPoolPanelProps {
  providers: Record<string, Provider>;
  currentProviderId?: string;
}

export function ModelPoolPanel({
  providers,
  currentProviderId,
}: ModelPoolPanelProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [pool, setPool] = useState<WebClientModelPool | null>(null);
  const [poolLoading, setPoolLoading] = useState(true);
  const [poolSaving, setPoolSaving] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const serverUrl = getWebApiBase() || window.location.origin;
  const accessKey = getWebAccessKey() ?? "";
  const authHeader = accessKey
    ? `-H 'Authorization: Bearer ${accessKey.replace(/'/g, "'\\''")}' `
    : "";
  const updateCommand = `curl -fsSL ${authHeader}'${serverUrl}/api/model-catalog/codex/install.sh' | bash`;
  const downloadOnlyCommand = `curl -fsSL ${authHeader}'${serverUrl}/api/model-catalog/codex' -o ~/.codex/cc-switch-all-models.json`;

  const providerList = useMemo(
    () => sortProvidersByName(Object.values(providers ?? {})),
    [providers],
  );
  const current =
    providerList.find((provider) => provider.id === currentProviderId) ?? null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPoolLoading(true);
      try {
        const data = await fetchWebClientModelPool();
        if (cancelled) return;
        setPool(data);
        setPoolError(null);
      } catch (error) {
        if (cancelled) return;
        setPoolError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setPoolLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistPool = async (next: string[], note: string) => {
    const previous = pool;
    setPool((current) =>
      current ? { ...current, models: next } : current,
    );
    setPoolSaving(true);
    try {
      const data = await saveWebClientModelPool(next);
      setPool(data);
      setPoolError(null);
      toast.success(note);
    } catch (error) {
      setPool(previous);
      toast.error(
        `模型池保存失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPoolSaving(false);
    }
  };

  const downloadModels = async (installer = false) => {
    setExporting(true);
    try {
      const result = await downloadWebModelFile(installer);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(
        installer ? "已下载模型导入工具" : "已导出模型池中的全部模型",
      );
    } catch (error) {
      toast.error(
        `导出失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setExporting(false);
    }
  };

  const copyCommand = async (command: string, note: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(command);
      } else {
        // 公网 HTTP 页面用不了 Clipboard API，保留兼容复制路径。
        const input = document.createElement("textarea");
        input.value = command;
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("请手动选择并复制下方命令");
      }
      toast.success(note);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const saveMapping = async (provider: Provider, from: string, to: string) => {
    const config = { ...settingsConfigOf(provider) };
    const mapping = { ...mappingOf(provider) };
    const key = from.trim();
    if (!to || to.toLowerCase() === key.toLowerCase()) {
      delete mapping[key];
    } else {
      mapping[key] = to;
    }
    if (Object.keys(mapping).length > 0) {
      config.modelMapping = mapping;
    } else {
      delete config.modelMapping;
    }
    setSavingKey(`${provider.id}:${key}`);
    try {
      await providersApi.update(
        { ...provider, settingsConfig: config },
        "codex",
        provider.id,
      );
      await queryClient.invalidateQueries({ queryKey: ["providers", "codex"] });
      toast.success(
        to ? `已保存映射：${key} → ${to}` : `已清除映射：${key}`,
        { closeButton: true },
      );
    } catch (error) {
      toast.error(
        `保存映射失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSavingKey(null);
    }
  };

  const poolModels = pool?.models ?? [];
  const visibleModels = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return poolModels;
    return poolModels.filter((model) =>
      model.toLowerCase().includes(keyword),
    );
  }, [poolModels, filter]);
  const sourcesOf = (model: string) =>
    pool?.sources?.[model] ?? pool?.sources?.[model.toLowerCase()] ?? [];
  const currentCatalog = current ? catalogModelsOf(current) : [];
  const currentMapping = current
    ? Object.entries(mappingOf(current)).sort(([left], [right]) =>
        left.localeCompare(right),
      )
    : [];

  if (providerList.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card/50">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
          <Wand2 className="h-4 w-4 text-amber-500" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">模型匹配池</span>
          <span className="block text-xs text-muted-foreground">
            左边是所有供应商的模型清单（导给远程主机用），右边是当前供应商的模型与映射。
          </span>
        </span>
        {(poolSaving || savingKey) && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-3">
            <span className="mr-auto text-xs text-muted-foreground">
              远程主机执行下面这行命令即可更新模型；它会先备份 config.toml 和模型文件，再把
              model_catalog_json 指过去。
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void downloadModels()}
            >
              {exporting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="mr-1 h-3.5 w-3.5" />
              )}
              导出模型配置
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={exporting}
              onClick={() => void downloadModels(true)}
            >
              <Download className="mr-1 h-3.5 w-3.5" />
              下载导入工具
            </Button>
          </div>

          <div className="px-4 pb-3 pt-2">
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
              <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-relaxed">
                {updateCommand}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2"
                onClick={() => void copyCommand(updateCommand, "已复制更新命令")}
              >
                <Copy className="mr-1 h-3.5 w-3.5" />
                复制
              </Button>
            </div>
            <button
              type="button"
              className="mt-1 text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              onClick={() =>
                void copyCommand(downloadOnlyCommand, "已复制只写模型文件的命令")
              }
            >
              只复制下载模型文件的命令
            </button>
          </div>

          <div className="grid border-t border-border md:grid-cols-2 md:divide-x md:divide-border">
            <div className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-sm font-medium">
                  全部供应商模型池
                </span>
                <span className="text-xs text-muted-foreground">
                  {poolLoading ? "读取中…" : `${poolModels.length} 个模型`}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={poolLoading || poolSaving || !pool}
                  onClick={() =>
                    void persistPool(
                      pool?.availableModels ?? [],
                      "已按当前所有供应商的模型重置模型池",
                    )
                  }
                >
                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  从所有供应商获取
                </Button>
              </div>

              {poolError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                  模型池读取失败：{poolError}
                </p>
              ) : null}

              <Input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="搜索模型名"
                className="h-8 text-xs"
              />

              <div className="max-h-80 overflow-y-auto rounded-md border border-border">
                {visibleModels.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-muted-foreground">
                    {poolLoading ? "正在读取模型池…" : "没有匹配的模型。"}
                  </p>
                ) : (
                  visibleModels.map((model) => {
                    const sources = sourcesOf(model);
                    return (
                      <div
                        key={model}
                        className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5 last:border-b-0 hover:bg-muted/40"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">
                          {model}
                        </span>
                        <span
                          className="max-w-[10rem] shrink-0 truncate text-[11px] text-muted-foreground"
                          title={sources.join("、")}
                        >
                          {sources.length > 0 ? sources.join("、") : "手动添加"}
                        </span>
                        <button
                          type="button"
                          title="从模型池移除"
                          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          onClick={() =>
                            void persistPool(
                              poolModels.filter((item) => item !== model),
                              `已从模型池移除：${model}`,
                            )
                          }
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex items-center gap-2">
                <Input
                  value={newModel}
                  onChange={(event) => setNewModel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const name = newModel.trim();
                    if (!name) return;
                    if (
                      poolModels.some(
                        (item) => item.toLowerCase() === name.toLowerCase(),
                      )
                    ) {
                      toast.error(`模型池里已经有 ${name}`);
                      return;
                    }
                    setNewModel("");
                    void persistPool(
                      [...poolModels, name],
                      `已加入模型池：${name}`,
                    );
                  }}
                  placeholder="添加模型名，例如 deepseek-v4.1-flash"
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    const name = newModel.trim();
                    if (!name) return;
                    if (
                      poolModels.some(
                        (item) => item.toLowerCase() === name.toLowerCase(),
                      )
                    ) {
                      toast.error(`模型池里已经有 ${name}`);
                      return;
                    }
                    setNewModel("");
                    void persistPool(
                      [...poolModels, name],
                      `已加入模型池：${name}`,
                    );
                  }}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  添加
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                模型池 = 所有 Codex 供应商的模型目录、默认模型、映射键和
                cc-auto / cc-switch-auto 的并集，也可以自己加名字。导出和
                <code className="mx-1 rounded bg-muted px-1">
                  python3 cc-switch-sync-models.py --url '{serverUrl}'
                </code>
                都以这份清单为准；远程主机上多留几个名字，切换供应商后总有能命中的。
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-auto text-sm font-medium">当前供应商</span>
                {current ? (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    {current.name}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    未选择供应商
                  </span>
                )}
              </div>

              {current ? (
                <>
                  <div className="rounded-md border border-border bg-background/60 px-2 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        默认模型（回落目标）
                      </span>
                      <span className="ml-auto font-mono">
                        {defaultModelOf(current) || "—"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="text-muted-foreground">
                        模型目录（{currentCatalog.length}）
                      </span>
                      {currentCatalog.map((model) => (
                        <span
                          key={model}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono"
                        >
                          {model}
                        </span>
                      ))}
                      {currentCatalog.length === 0 && (
                        <span className="text-muted-foreground">
                          未设置，未匹配的请求原样透传
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="mr-auto text-xs font-medium">
                      映射（客户端模型 → 实际转发模型）
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {currentMapping.length} 条
                    </span>
                  </div>

                  <div className="rounded-md border border-border">
                    {currentMapping.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        没有显式映射，都按 档位别名 / 目录命中 / 回落默认
                        解析。
                      </p>
                    ) : (
                      currentMapping.map(([from, to]) => (
                        <div
                          key={from}
                          className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5 last:border-b-0"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">
                            {from}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            →
                          </span>
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-xs"
                            title={to}
                          >
                            {to}
                          </span>
                          <RuleBadge rule="mapping" />
                          <button
                            type="button"
                            title="删除这条映射"
                            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            onClick={() =>
                              void saveMapping(current, from, "")
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      value={newFrom}
                      onChange={(event) => setNewFrom(event.target.value)}
                      list="cc-model-pool-models"
                      placeholder="客户端模型"
                      className="h-8 font-mono text-xs"
                    />
                    <span className="shrink-0 text-muted-foreground">→</span>
                    <Input
                      value={newTo}
                      onChange={(event) => setNewTo(event.target.value)}
                      list="cc-current-provider-models"
                      placeholder="实际转发模型"
                      className="h-8 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={!newFrom.trim() || !newTo.trim()}
                      onClick={() => {
                        const from = newFrom.trim();
                        const to = newTo.trim();
                        if (!from || !to) return;
                        setNewFrom("");
                        setNewTo("");
                        void saveMapping(current, from, to);
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      添加
                    </Button>
                  </div>

                  <datalist id="cc-model-pool-models">
                    {poolModels.map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                  <datalist id="cc-current-provider-models">
                    {currentCatalog.map((model) => (
                      <option key={model} value={model} />
                    ))}
                    {defaultModelOf(current) ? (
                      <option value={defaultModelOf(current)} />
                    ) : null}
                  </datalist>

                  <div className="rounded-md border border-border bg-background/60 px-2 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-mono">
                        cc-auto
                      </span>
                      <span className="shrink-0 text-muted-foreground">→</span>
                      <span className="min-w-0 flex-1 truncate font-mono">
                        {resolveModel(current, "cc-auto").model}
                      </span>
                      <RuleBadge rule={resolveModel(current, "cc-auto").rule} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      档位别名跟着当前供应商走，客户端写 cc-auto
                      就不用改配置。
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  在上面的供应商列表里选中一个 Codex 供应商，这里会显示它的模型和映射。
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
