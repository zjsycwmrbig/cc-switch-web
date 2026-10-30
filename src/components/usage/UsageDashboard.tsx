import { useUnitSession } from "@/components/unit/session";
import { getUsageScope, setUsageScope } from "@/lib/runtime/client/web";
import { UsageHeatmap } from "./UsageHeatmap";
import { ProviderIcon } from "@/components/ProviderIcon";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UsageSummaryCards } from "./UsageSummaryCards";
import { UsageTrendChart } from "./UsageTrendChart";
import { RequestLogTable } from "./RequestLogTable";
import { ProviderStatsTable } from "./ProviderStatsTable";
import { ModelStatsTable } from "./ModelStatsTable";
import { UserStatsTable } from "./UserStatsTable";
import { DataSourceBar } from "./DataSourceBar";
import type { AppTypeFilter, UsageRangeSelection } from "@/types/usage";
import { motion } from "framer-motion";
import {
  BarChart3,
  ListFilter,
  Activity,
  RefreshCw,
  Coins,
  Loader2,
  ScanSearch,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usageApi } from "@/lib/api/usage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usageKeys } from "@/lib/query/usage";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PricingConfigPanel } from "@/components/usage/PricingConfigPanel";
import { cn } from "@/lib/utils";
import { getLocaleFromLanguage } from "./format";
import { getUsageRangePresetLabel, resolveUsageRange } from "@/lib/usageRange";
import { UsageDateRangePicker } from "./UsageDateRangePicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const APP_FILTER_OPTIONS: AppTypeFilter[] = [
  "all",
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "pi",
  "mcode",
];

interface UsageDashboardProps {
  sessionAutoSyncEnabled?: boolean;
  onSessionAutoSyncEnabledChange?: (next: boolean) => Promise<void> | void;
}

export function UsageDashboard({
  sessionAutoSyncEnabled = true,
  onSessionAutoSyncEnabledChange,
}: UsageDashboardProps = {}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const session = useUnitSession();
  const [scope, changeScope] = useState(getUsageScope);
  const { data: lastSessionScan } = useQuery({
    queryKey: [...usageKeys.all, "last-session-scan"],
    queryFn: usageApi.getLastSessionScan,
    refetchInterval: 30_000,
  });
  const [syncingSession, setSyncingSession] = useState(false);

  // 手动触发一次会话日志同步：手动模式下是唯一的直连用量补录途径，
  // 入口按钮仅在关闭自动扫描时展示（自动模式有后台定时扫描，无需手动触发）
  const runManualSessionSync = async () => {
    setSyncingSession(true);
    try {
      const result = await usageApi.syncSessionUsage();
      await queryClient.invalidateQueries({ queryKey: usageKeys.all });
      const message = t("usage.sessionSync.syncCompleted", {
        imported: result.imported,
        files: result.filesScanned,
        errors: result.errors.length,
      });
      if (result.errors.length > 0) {
        toast.warning(message);
      } else {
        toast.success(message);
      }
    } catch (error) {
      toast.error(
        t("usage.sessionSync.syncFailed", {
          error: String(error),
        }),
      );
    } finally {
      setSyncingSession(false);
    }
  };
  const [range, setRange] = useState<UsageRangeSelection>({ preset: "today" });
  const [appType, setAppType] = useState<AppTypeFilter>("all");
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(30000);

  const refreshIntervalOptionsMs = [0, 5000, 10000, 30000, 60000] as const;
  const changeRefreshInterval = () => {
    const currentIndex = refreshIntervalOptionsMs.indexOf(
      refreshIntervalMs as (typeof refreshIntervalOptionsMs)[number],
    );
    const safeIndex = currentIndex >= 0 ? currentIndex : 3; // default 30s
    const nextIndex = (safeIndex + 1) % refreshIntervalOptionsMs.length;
    const next = refreshIntervalOptionsMs[nextIndex];
    setRefreshIntervalMs(next);
    queryClient.invalidateQueries({ queryKey: usageKeys.all });
  };

  const language = i18n.resolvedLanguage || i18n.language || "en";
  const locale = getLocaleFromLanguage(language);
  const resolvedRange = useMemo(() => resolveUsageRange(range), [range]);
  const rangeLabel = useMemo(() => {
    if (range.preset !== "custom") {
      return getUsageRangePresetLabel(range.preset, t);
    }

    return `${new Date(resolvedRange.startDate * 1000).toLocaleString(locale)} - ${new Date(
      resolvedRange.endDate * 1000,
    ).toLocaleString(locale)}`;
  }, [locale, range, resolvedRange.endDate, resolvedRange.startDate, t]);
  const scopeOptions = [
    { value: "all", label: "全平台", adminOnly: true },
    { value: "mine", label: "我调用" },
    { value: "provided", label: "我提供" },
  ].filter((option) => !option.adminOnly || session?.me.user.role === "admin");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8 pb-8"
    >
      {session && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
          <span className="text-muted-foreground">统计范围</span>
          <div
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1"
            role="group"
            aria-label="统计范围"
          >
            {scopeOptions.map((option) => {
              const active = scope === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                  onClick={() => {
                    setUsageScope(option.value);
                    changeScope(option.value);
                    void queryClient.invalidateQueries({
                      queryKey: usageKeys.all,
                    });
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <span className="text-muted-foreground">
            聚合网关账本 · 未定价成本与待核算额度会在明细中单独标记。
          </span>
        </div>
      )}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold">{t("usage.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("usage.subtitle")}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card/40 backdrop-blur-sm p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {APP_FILTER_OPTIONS.map((type) => (
              <button
                key={type}
                type="button"
                aria-label={t(`usage.appFilter.${type}`)}
                title={t(`usage.appFilter.${type}`)}
                aria-pressed={appType === type}
                onClick={() => setAppType(type)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-sm font-medium transition-all",
                  appType === type
                    ? "bg-primary/10 text-primary shadow-sm border border-primary/20"
                    : "text-muted-foreground hover:text-primary hover:bg-muted/50 border border-transparent",
                )}
              >
                {type === "all" ? (
                  t(`usage.appFilter.${type}`)
                ) : (
                  <ProviderIcon
                    name={t(`usage.appFilter.${type}`)}
                    icon={
                      (
                        {
                          claude: "claude",
                          codex: "openai",
                          gemini: "gemini",
                          grokbuild: "grok",
                          pi: "pi",
                          mcode: "minimax",
                          opencode: "opencode",
                        } as Record<string, string>
                      )[type]
                    }
                    size={20}
                  />
                )}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                title={t("common.refresh", "刷新")}
                onClick={changeRefreshInterval}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                {refreshIntervalMs > 0 ? `${refreshIntervalMs / 1000}s` : "--"}
              </Button>

              <UsageDateRangePicker
                selection={range}
                triggerLabel={rangeLabel}
                onApply={(nextRange) => setRange(nextRange)}
              />
            </div>
          </div>
        </div>
      </div>

      <DataSourceBar refreshIntervalMs={refreshIntervalMs} />

      {lastSessionScan ? (
        <p className="text-xs text-muted-foreground">
          {t("usage.lastSessionScan", {
            time: new Date(lastSessionScan).toLocaleString(i18n.language),
          })}
        </p>
      ) : null}
      <UsageSummaryCards
        range={range}
        appType={appType}
        refreshIntervalMs={refreshIntervalMs}
      />

      {range.preset === "all" ? (
        <UsageHeatmap appType={appType} refreshIntervalMs={refreshIntervalMs} />
      ) : (
        <UsageTrendChart
          range={range}
          rangeLabel={rangeLabel}
          appType={appType}
          refreshIntervalMs={refreshIntervalMs}
        />
      )}

      <div className="space-y-4">
        <Tabs defaultValue="logs" className="w-full">
          <div className="flex items-center justify-between mb-4">
            <TabsList className="w-full justify-start overflow-x-auto bg-muted/50 sm:w-auto">
              <TabsTrigger value="logs" className="gap-2">
                <ListFilter className="h-4 w-4" />
                {t("usage.requestLogs")}
              </TabsTrigger>
              <TabsTrigger value="providers" className="gap-2">
                <Activity className="h-4 w-4" />
                {t("usage.providerStats")}
              </TabsTrigger>
              {session && (
                <TabsTrigger value="users" className="gap-2">
                  <Users className="h-4 w-4" />
                  {t("usage.userStats")}
                </TabsTrigger>
              )}
              <TabsTrigger value="models" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                {t("usage.modelStats")}
              </TabsTrigger>
            </TabsList>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <TabsContent value="logs" className="mt-0">
              <RequestLogTable
                range={range}
                rangeLabel={rangeLabel}
                appType={appType}
                refreshIntervalMs={refreshIntervalMs}
                onRangeChange={setRange}
              />
            </TabsContent>

            <TabsContent value="providers" className="mt-0">
              <ProviderStatsTable
                range={range}
                appType={appType}
                refreshIntervalMs={refreshIntervalMs}
              />
            </TabsContent>

            {session && (
              <TabsContent value="users" className="mt-0">
                <UserStatsTable
                  range={range}
                  appType={appType}
                  refreshIntervalMs={refreshIntervalMs}
                />
              </TabsContent>
            )}

            <TabsContent value="models" className="mt-0">
              <ModelStatsTable
                range={range}
                appType={appType}
                refreshIntervalMs={refreshIntervalMs}
              />
            </TabsContent>
          </motion.div>
        </Tabs>
      </div>

      {!session && (
      <div className="rounded-xl glass-card px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ScanSearch className="h-5 w-5 text-sky-500" />
          <div>
            <h3 className="text-base font-semibold">
              {t("usage.sessionSync.title")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("usage.sessionSync.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!sessionAutoSyncEnabled && (
            <Button
              variant="outline"
              size="sm"
              disabled={!!session || syncingSession}
              onClick={() => void runManualSessionSync()}
            >
              {syncingSession ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {t("usage.sessionSync.syncNow")}
            </Button>
          )}
          <Switch
            disabled={!!session}
            checked={!session && sessionAutoSyncEnabled}
            onCheckedChange={(value) =>
              void onSessionAutoSyncEnabledChange?.(value)
            }
            aria-label={t("usage.sessionSync.title")}
          />
        </div>
      </div>

      )}

      {/* Pricing Configuration */}
      <Accordion type="multiple" defaultValue={[]} className="w-full space-y-4">
        <AccordionItem
          value="pricing"
          className="rounded-xl glass-card overflow-hidden"
        >
          <AccordionTrigger className="px-6 py-4 hover:no-underline hover:bg-muted/50 data-[state=open]:bg-muted/50">
            <div className="flex items-center gap-3">
              <Coins className="h-5 w-5 text-yellow-500" />
              <div className="text-left">
                <h3 className="text-base font-semibold">
                  {t("settings.advanced.pricing.title")}
                </h3>
                <p className="text-sm text-muted-foreground font-normal">
                  {t("settings.advanced.pricing.description")}
                </p>
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6 pt-4 border-t border-border/50">
            <fieldset disabled={!!session && session.me.user.role !== "admin"}>
              <PricingConfigPanel />
            </fieldset>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </motion.div>
  );
}
