import {
  unit,
  type PersonalCodexCatalog,
  type Preferences,
} from "@/components/unit/client";
import { useUnitSession } from "@/components/unit/session";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  downloadWebAggregationModels,
  getWebAccessKey,
  getWebApiBase,
} from "@/lib/runtime/client/web";

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const PAGE_SIZE = 10;

export function AggregationSyncPanel({
  onPersonalModels,
  onDevices,
  onPreferencesSaved,
  refreshKey = 0,
}: {
  onPersonalModels?: () => void;
  onDevices?: () => void;
  onPreferencesSaved?: (preferences: Preferences) => void;
  refreshKey?: number;
} = {}) {
  const session = useUnitSession();
  const [personalCommand, setPersonalCommand] = useState("");
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<PersonalCodexCatalog | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogRequest, setCatalogRequest] = useState(0);
  const [preferenceBusy, setPreferenceBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [page, setPage] = useState(1);
  const origin = (getWebApiBase() || window.location.origin).replace(/\/$/, "");
  const key = getWebAccessKey();
  const auth = key ? `-H ${quote(`Authorization: Bearer ${key}`)} ` : "";
  const legacyCommand = `curl -fsSL ${auth}${quote(`${origin}/api/model-catalog/codex/aggregation/install.sh`)} | CC_SWITCH_RESTART_APP_SERVER=1 bash`;
  const command = session ? personalCommand : legacyCommand;
  const totalPages = Math.max(
    1,
    Math.ceil((catalog?.models.length ?? 0) / PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages);
  const visibleModels =
    catalog?.models.slice(
      (currentPage - 1) * PAGE_SIZE,
      currentPage * PAGE_SIZE,
    ) ?? [];
  useEffect(() => {
    if (!session) {
      setCatalog(null);
      setCatalogError("");
      setCatalogBusy(false);
      return;
    }
    let live = true;
    setCatalogBusy(true);
    setCatalogError("");
    void unit<PersonalCodexCatalog>("/catalog")
      .then((value) => {
        if (live) setCatalog(value);
      })
      .catch((error) => {
        if (!live) return;
        setCatalog(null);
        setCatalogError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (live) setCatalogBusy(false);
      });
    return () => {
      live = false;
    };
  }, [refreshKey, session, catalogRequest]);
  const ensureCommand = async () => {
    if (session && !personalCommand) {
      setBusy(true);
      try {
        const value = await unit<{ command: string }>("/keys", "POST", {
          name: `网页模型同步 ${new Date().toLocaleString()}`,
        });
        setPersonalCommand(value.command);
        return value.command;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return "";
      } finally {
        setBusy(false);
      }
    }
    return command;
  };
  const copyText = async (toCopy: string) => {
    if (!toCopy) return;
    try {
      await navigator.clipboard.writeText(toCopy);
      toast.success(t("aggregationSync.copied"));
    } catch {
      // HTTP 网页没有 Clipboard API 时，仍可直接选中下方命令复制。
      const area = document.createElement("textarea");
      area.value = toCopy;
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand("copy");
      area.remove();
      if (copied) toast.success(t("aggregationSync.copied"));
      else toast.error(t("aggregationSync.copyManually"));
    }
  };
  const copy = async () => {
    await copyText(await ensureCommand());
  };
  const copyRestore = async () => {
    const value = await ensureCommand();
    await copyText(value.replace(/ bash$/, " bash -s -- restore"));
  };
  const download = async () => {
    setBusy(true);
    try {
      const file = await downloadWebAggregationModels();
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const saveVisibleModels = async (
    update: (models: string[]) => string[],
    successMessage: string,
  ) => {
    setPreferenceBusy(true);
    try {
      const preferences = await unit<Preferences>("/preferences");
      const current =
        preferences.models ?? catalog?.models.map((model) => model.slug) ?? [];
      const models = update(current);
      const next: Preferences = { ...preferences, models };
      if (!next.startupModel || !models.includes(next.startupModel)) {
        if (models.length) next.startupModel = models[0];
        else delete next.startupModel;
      }
      await unit<Preferences>("/preferences", "PUT", next);
      onPreferencesSaved?.(next);
      setCatalogRequest((value) => value + 1);
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setPreferenceBusy(false);
    }
  };
  const removeModel = (slug: string, name: string) =>
    saveVisibleModels(
      (models) => models.filter((model) => model !== slug),
      `已从 Codex 模型目录删除“${name}”`,
    );
  const clearModels = () => {
    if (
      !window.confirm(
        "确定清空当前 Codex 模型目录吗？映射路由和实际请求转发不会受影响。",
      )
    )
      return;
    void saveVisibleModels(() => [], "已清空 Codex 同步展示模型");
  };
  return (
    <section className="rounded-lg border border-border p-4">
      <button
        type="button"
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-expanded={expanded}
        aria-controls="aggregation-sync-panel-content"
        aria-label={expanded ? "收起同步聚合模型" : "展开同步聚合模型"}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            expanded ? "" : "-rotate-90"
          }`}
        />
        <h3 className="text-sm font-medium">{t("aggregationSync.title")}</h3>
        {session && catalog && (
          <span className="text-xs text-muted-foreground">
            {catalog.models.length} 个模型
          </span>
        )}
      </button>
      {expanded && (
        <div id="aggregation-sync-panel-content" className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="max-w-2xl text-sm text-muted-foreground">
              {session
                ? "这里常驻展示当前 Codex 模型目录。同步命令只更新 Codex 可见模型；实际请求路由由映射决定，与这里的勾选无关。"
                : t("aggregationSync.description")}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void download()}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1 h-4 w-4" />
                )}
                {t("aggregationSync.download")}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void copy()}>
                <Copy className="mr-1 h-4 w-4" />
                {session && !command
                  ? "生成并复制我的同步命令"
                  : t("aggregationSync.copy")}
              </Button>
            </div>
          </div>
          {session && (onPersonalModels || onDevices) && (
            <div className="flex gap-2">
              {onPersonalModels && (
                <Button size="sm" variant="ghost" onClick={onPersonalModels}>
                  选择我的模型
                </Button>
              )}
              {onDevices && (
                <Button size="sm" variant="ghost" onClick={onDevices}>
                  管理设备密钥
                </Button>
              )}
            </div>
          )}
          {command && (
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs select-all">
              {command}
            </pre>
          )}
          {session && (
            <div
              className="space-y-2 rounded-md border border-border bg-muted/30 p-3"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-medium">当前 Codex 模型目录</h4>
                  {!catalogBusy && catalog && (
                    <span className="text-xs text-muted-foreground">
                      {catalog.models.length} 个
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    disabled={
                      preferenceBusy ||
                      (catalogBusy && !catalog) ||
                      Boolean(catalogError)
                    }
                    onClick={clearModels}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    清空同步模型
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    disabled={catalogBusy || preferenceBusy}
                    onClick={() => {
                      setPage(1);
                      setCatalogRequest((value) => value + 1);
                    }}
                  >
                    <RefreshCw
                      className={`mr-1 h-3.5 w-3.5 ${
                        catalogBusy ? "animate-spin" : ""
                      }`}
                    />
                    刷新
                  </Button>
                </div>
              </div>
              {catalogBusy && !catalog ? (
                <p className="text-xs text-muted-foreground">
                  正在读取模型目录…
                </p>
              ) : catalogError ? (
                <p className="text-xs text-destructive">
                  模型目录读取失败：{catalogError}
                </p>
              ) : catalog?.models.length ? (
                <>
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {visibleModels.map((model) => (
                      <li
                        className="min-w-0 rounded border border-border/70 bg-background/60 px-2 py-1.5"
                        key={model.slug}
                      >
                        <div className="flex min-w-0 items-start gap-1">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-medium">
                                {model.display_name || model.slug}
                              </span>
                              {catalog.default_model === model.slug && (
                                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                                  默认
                                </span>
                              )}
                            </div>
                            <code className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {model.slug}
                            </code>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label={`从 Codex 模型目录删除 ${
                              model.display_name || model.slug
                            }`}
                            title="从同步展示中删除"
                            disabled={preferenceBusy || catalogBusy}
                            onClick={() =>
                              void removeModel(
                                model.slug,
                                model.display_name || model.slug,
                              )
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {catalog.warnings?.map((warning) => (
                    <p className="text-xs text-amber-600" key={warning}>
                      {warning}
                    </p>
                  ))}
                  {totalPages > 1 && (
                    <nav
                      className="flex items-center justify-end gap-2 border-t border-border/60 pt-2"
                      aria-label="Codex 模型目录分页"
                    >
                      <span className="text-xs text-muted-foreground">
                        第 {currentPage} / {totalPages} 页
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="上一页"
                        title="上一页"
                        disabled={currentPage <= 1 || catalogBusy}
                        onClick={() => setPage(Math.max(1, currentPage - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="下一页"
                        title="下一页"
                        disabled={currentPage >= totalPages || catalogBusy}
                        onClick={() =>
                          setPage(Math.min(totalPages, currentPage + 1))
                        }
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </nav>
                  )}
                </>
              ) : catalog ? (
                <p className="text-xs text-muted-foreground">
                  当前没有同步展示模型。可在“模型与路由”中单条或批量加入；映射路由仍会处理请求。
                </p>
              ) : null}
            </div>
          )}
          {command && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                已同步配置的固定备份可通过还原命令恢复，并自动重启 Codex。
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void copyRestore()}
              >
                <Copy className="mr-1 h-4 w-4" />
                复制还原命令
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t("aggregationSync.reload")}
          </p>
        </div>
      )}
    </section>
  );
}
