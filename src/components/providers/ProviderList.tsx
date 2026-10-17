import { useUnitSession } from "@/components/unit/session";
import type { AppModeView } from "@/types/proxy";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Provider } from "@/types";
import type { AppId } from "@/lib/api";
import { providersApi } from "@/lib/api/providers";
import { claudeDesktopApi } from "@/lib/api/claudeDesktop";
import { extractErrorMessage } from "@/utils/errorUtils";
import { sortProvidersByName } from "@/utils/providerSort";
import {
  useOpenClawLiveProviderIds,
  useOpenClawDefaultModel,
} from "@/hooks/useOpenClaw";
import {
  useHermesLiveProviderIds,
  useHermesModelConfig,
} from "@/hooks/useHermes";
import { useStreamCheck } from "@/hooks/useStreamCheck";
import { ProviderCard } from "@/components/providers/ProviderCard";
import { ProviderEmptyState } from "@/components/providers/ProviderEmptyState";
import { ProviderIcon } from "@/components/ProviderIcon";
import { PageTabs } from "@/components/ui/page-tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { unit, type Budget } from "@/components/unit/client";
import {
  useAutoFailoverEnabled,
  useFailoverQueue,
  useAddToFailoverQueue,
  useRemoveFromFailoverQueue,
} from "@/lib/query/failover";
import {
  useCurrentOmoProviderId,
  useCurrentOmoSlimProviderId,
} from "@/lib/query/omo";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { settingsApi } from "@/lib/api/settings";
import { invalidatePiProviderCaches } from "@/lib/query/pi";

type UnitProviderTab = "library" | "owned" | "shared";

const UNIT_PAGE_SIZE = 6;

/** 授权额度是否不限（三个维度都留空）。 */
function isUnlimitedBudget(budget?: Budget) {
  return (
    !budget ||
    (budget.requests == null &&
      budget.tokens == null &&
      budget.credits == null)
  );
}

function budgetLabel(budget?: Budget) {
  if (!budget) return "不限";
  const parts: string[] = [];
  if (budget.requests != null) parts.push(`${budget.requests} 次`);
  if (budget.tokens != null) parts.push(`${budget.tokens} tokens`);
  if (budget.credits != null) parts.push(`${budget.credits} 点`);
  return parts.length ? parts.join(" / ") : "不限";
}

/** 供应商库条目：平台上一个已发布的供应商，以及它的归属信息。 */
type UnitLibraryProvider = {
  id: string;
  name: string;
  icon?: string;
  unitResource: {
    id: string;
    ownerName: string;
    owned: boolean;
    disabled: boolean;
    official: boolean;
    accessible?: boolean;
    modelCount?: number;
    myApplication?: string | null;
    myBudget?: Budget;
  };
};

interface ProviderListProps {
  modeView?: AppModeView;
  modePending?: boolean;
  onAggregationMember?: (id: string, enabled: boolean) => void;
  onAggregationDefault?: (id: string) => void;
  providers: Record<string, Provider>;
  currentProviderId: string;
  appId: AppId;
  onSwitch: (provider: Provider) => void;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onRemoveFromConfig?: (provider: Provider) => void;
  onDisableOmo?: () => void;
  onDisableOmoSlim?: () => void;
  onDuplicate: (provider: Provider) => void;
  onConfigureUsage?: (provider: Provider) => void;
  onOpenWebsite: (url: string) => void;
  onOpenTerminal?: (provider: Provider) => void;
  onCreate?: () => void;
  isLoading?: boolean;
  isProxyRunning?: boolean; // 代理服务运行状态
  isProxyTakeover?: boolean; // 代理接管模式（Live配置已被接管）
  activeProviderId?: string; // 代理当前实际使用的供应商 ID（用于故障转移模式下标注绿色边框）
  onSetAsDefault?: (provider: Provider) => void; // OpenClaw: set as default model
}

export function ProviderList({
  modeView,
  modePending,
  onAggregationMember,
  onAggregationDefault,
  providers,
  currentProviderId,
  appId,
  onSwitch,
  onEdit,
  onDelete,
  onRemoveFromConfig,
  onDisableOmo,
  onDisableOmoSlim,
  onDuplicate,
  onConfigureUsage,
  onOpenWebsite,
  onOpenTerminal,
  onCreate,
  isLoading = false,
  isProxyRunning = false,
  isProxyTakeover = false,
  activeProviderId,
  onSetAsDefault,
}: ProviderListProps) {
  const { t } = useTranslation();
  const session = useUnitSession();
  const { checkProvider, isChecking } = useStreamCheck(appId);
  const sortedProviders = useMemo(
    () => sortProvidersByName(Object.values(providers)),
    [providers],
  );

  const { data: opencodeLiveIds, isPending: opencodeLivePending } = useQuery({
    queryKey: ["opencodeLiveProviderIds"],
    queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
    enabled: appId === "opencode",
  });

  const { data: piLiveIds, isPending: piLivePending } = useQuery({
    queryKey: ["piLiveProviderIds"],
    queryFn: () => providersApi.getPiLiveProviderIds(),
    enabled: appId === "pi",
  });

  // OpenClaw: 查询 live 配置中的供应商 ID 列表，用于判断 isInConfig
  const { data: openclawLiveIds, isPending: openclawLivePending } =
    useOpenClawLiveProviderIds(appId === "openclaw");

  const { data: hermesLiveIds, isPending: hermesLivePending } =
    useHermesLiveProviderIds(appId === "hermes");
  const { data: hermesModelConfig } = useHermesModelConfig(appId === "hermes");
  const hermesCurrentProviderId = hermesModelConfig?.provider;

  // 判断供应商是否已添加到配置（累加模式应用：OpenCode/OpenClaw/Hermes）
  const isProviderInConfig = useCallback(
    (providerId: string): boolean => {
      if (appId === "mcode")
        return providers[providerId]?.meta?.liveConfigManaged === true;
      if (appId === "opencode") {
        return opencodeLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "openclaw") {
        return openclawLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "hermes") {
        return hermesLiveIds?.includes(providerId) ?? false;
      }
      if (appId === "pi") {
        return piLiveIds?.includes(providerId) ?? false;
      }
      return true; // 其他应用始终返回 true
    },
    [
      appId,
      opencodeLiveIds,
      openclawLiveIds,
      hermesLiveIds,
      piLiveIds,
      providers,
    ],
  );

  // OpenClaw: query default model to determine which provider is default
  const { data: openclawDefaultModel } = useOpenClawDefaultModel(
    appId === "openclaw",
  );

  const isProviderDefaultModel = useCallback(
    (providerId: string): boolean => {
      if (appId !== "openclaw" || !openclawDefaultModel?.primary) return false;
      return openclawDefaultModel.primary.startsWith(providerId + "/");
    },
    [appId, openclawDefaultModel],
  );

  // 故障转移相关
  const supportsFailover =
    !session && !["opencode", "openclaw", "hermes", "pi"].includes(appId);
  const { data: isAutoFailoverEnabled } = useAutoFailoverEnabled(
    appId,
    supportsFailover,
  );
  const { data: failoverQueue } = useFailoverQueue(appId, supportsFailover);
  const addToQueue = useAddToFailoverQueue();
  const removeFromQueue = useRemoveFromFailoverQueue();

  const isFailoverModeActive =
    modeView?.mode !== "aggregation" &&
    isProxyTakeover === true &&
    isAutoFailoverEnabled === true;

  const isOpenCode = appId === "opencode";
  const { data: currentOmoId } = useCurrentOmoProviderId(isOpenCode);
  const { data: currentOmoSlimId } = useCurrentOmoSlimProviderId(isOpenCode);

  const getFailoverPriority = useCallback(
    (providerId: string): number | undefined => {
      if (!isFailoverModeActive || !failoverQueue) return undefined;
      const index = failoverQueue.findIndex(
        (item) => item.providerId === providerId,
      );
      return index >= 0 ? index + 1 : undefined;
    },
    [isFailoverModeActive, failoverQueue],
  );

  const isInFailoverQueue = useCallback(
    (providerId: string): boolean => {
      if (!isFailoverModeActive || !failoverQueue) return false;
      return failoverQueue.some((item) => item.providerId === providerId);
    },
    [isFailoverModeActive, failoverQueue],
  );

  const handleToggleFailover = useCallback(
    (providerId: string, enabled: boolean) => {
      if (enabled) {
        addToQueue.mutate({ appType: appId, providerId });
      } else {
        removeFromQueue.mutate({ appType: appId, providerId });
      }
    },
    [appId, addToQueue, removeFromQueue],
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [unitTab, setUnitTab] = useState<UnitProviderTab>("owned");
  const [unitPage, setUnitPage] = useState(1);
  const [applyTarget, setApplyTarget] = useState<UnitLibraryProvider | null>(
    null,
  );
  const [applyBudget, setApplyBudget] = useState<Budget>({});
  const [applyMessage, setApplyMessage] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const { data: claudeDesktopStatus } = useQuery({
    queryKey: ["claudeDesktopStatus"],
    queryFn: () => claudeDesktopApi.getStatus(),
    enabled: appId === "claude-desktop",
    refetchInterval: appId === "claude-desktop" ? 5000 : false,
  });
  const [showStreamCheckConfirm, setShowStreamCheckConfirm] = useState(false);
  const [pendingTestProvider, setPendingTestProvider] =
    useState<Provider | null>(null);

  // Query settings for streamCheckConfirmed flag
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  });

  const handleTest = useCallback(
    (provider: Provider) => {
      if (!settings?.streamCheckConfirmed) {
        setPendingTestProvider(provider);
        setShowStreamCheckConfirm(true);
      } else {
        checkProvider(provider.id, provider.name);
      }
    },
    [checkProvider, settings?.streamCheckConfirmed],
  );

  const handleStreamCheckConfirm = async () => {
    setShowStreamCheckConfirm(false);
    try {
      if (settings) {
        const { webdavSync: _, ...rest } = settings;
        await settingsApi.save({ ...rest, streamCheckConfirmed: true });
        await queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
    } catch (error) {
      console.error("Failed to save stream check confirmed:", error);
    }
    if (pendingTestProvider) {
      checkProvider(pendingTestProvider.id, pendingTestProvider.name);
      setPendingTestProvider(null);
    }
  };

  // Import current live config as default provider
  const queryClient = useQueryClient();
  const importMutation = useMutation({
    mutationFn: async (): Promise<boolean> => {
      if (appId === "opencode") {
        const count = await providersApi.importOpenCodeFromLive();
        return count > 0;
      }
      if (appId === "openclaw") {
        const count = await providersApi.importOpenClawFromLive();
        return count > 0;
      }
      if (appId === "pi") {
        const count = await providersApi.importPiFromLive();
        return count > 0;
      }
      return providersApi.importDefault(appId);
    },
    onSuccess: (imported) => {
      if (imported) {
        queryClient.invalidateQueries({ queryKey: ["providers", appId] });
        if (appId === "claude-desktop") {
          queryClient.invalidateQueries({ queryKey: ["claudeDesktopStatus"] });
        }
        if (appId === "pi") {
          void invalidatePiProviderCaches(queryClient);
        }
        toast.success(t("provider.importCurrentDescription"));
      } else {
        toast.info(t("provider.noProviders"));
      }
    },
    onError: (error: unknown) => {
      toast.error(extractErrorMessage(error) || t("settings.importFailed"));
      // 失败前可能已导入部分条目，仍需刷新列表呈现真实状态。
      queryClient.invalidateQueries({ queryKey: ["providers", appId] });
    },
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "f") {
        event.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      if (key === "escape") {
        setIsSearchOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (isSearchOpen) {
      const frame = requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [isSearchOpen]);

  const filteredProviders = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return sortedProviders;
    return sortedProviders.filter((provider) => {
      const fields = [provider.name, provider.notes, provider.websiteUrl];
      return fields.some((field) =>
        field?.toString().toLowerCase().includes(keyword),
      );
    });
  }, [searchTerm, sortedProviders]);

  const { data: unitLibrary } = useQuery({
    queryKey: ["unit", "providerLibrary", appId],
    queryFn: () =>
      unit<{ providers: Record<string, UnitLibraryProvider> }>(
        `/ui/library/${appId}`,
      ),
    enabled: Boolean(session),
  });

  const unitLibraryEntries = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return Object.values(unitLibrary?.providers ?? {})
      .filter((entry) =>
        keyword
          ? `${entry.unitResource.ownerName} 的 ${entry.name}`
              .toLowerCase()
              .includes(keyword)
          : true,
      )
      .sort((a, b) =>
        `${a.unitResource.ownerName} 的 ${a.name}`.localeCompare(
          `${b.unitResource.ownerName} 的 ${b.name}`,
          "zh-Hans-CN",
        ),
      );
  }, [searchTerm, unitLibrary]);

  useEffect(() => {
    const ownedCount = filteredProviders.filter(
      (provider) => !provider.unitResource || provider.unitResource.owned,
    ).length;
    if (session && unitTab === "owned" && ownedCount === 0 && unitLibraryEntries.length > 0) {
      setUnitTab("library");
      setUnitPage(1);
    }
  }, [filteredProviders, session, unitLibraryEntries.length, unitTab]);

  const submitApplication = async () => {
    if (!applyTarget) return;
    setApplyBusy(true);
    try {
      const result = await unit<{ id: string; state: string }>(
        "/applications",
        "POST",
        {
          resourceId: applyTarget.unitResource.id,
          budget: applyBudget,
          models: [],
          message: applyMessage,
        },
      );
      toast.success(
        result.state === "approved"
          ? "已按免审规则自动通过，可直接使用"
          : "申请已提交，等待提供者审批",
      );
      setApplyTarget(null);
      setApplyBudget({});
      setApplyMessage("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["unit", "providerLibrary", appId],
        }),
        queryClient.invalidateQueries({ queryKey: ["unit", "applications"] }),
        queryClient.invalidateQueries({ queryKey: ["providers", appId] }),
      ]);
    } catch (error) {
      toast.error(extractErrorMessage(error));
    } finally {
      setApplyBusy(false);
    }
  };

  useEffect(() => {
    setUnitPage(1);
  }, [unitTab, searchTerm, appId]);

  const claudeDesktopStatusMessages = useMemo(() => {
    if (appId !== "claude-desktop" || !claudeDesktopStatus) return [];

    const messages: string[] = [];
    if (!claudeDesktopStatus.supported) {
      return [t("claudeDesktop.statusUnsupported")];
    }
    if (claudeDesktopStatus.staleRawModels) {
      messages.push(t("claudeDesktop.statusStaleRawModels"));
    }
    if (claudeDesktopStatus.missingRouteMappings) {
      messages.push(t("claudeDesktop.statusMissingRouteMappings"));
    }
    if (
      claudeDesktopStatus.mode === "proxy" &&
      !claudeDesktopStatus.gatewayTokenConfigured
    ) {
      messages.push(t("claudeDesktop.statusGatewayTokenMissing"));
    }

    const expected = claudeDesktopStatus.expectedBaseUrl?.replace(/\/+$/, "");
    const actual = claudeDesktopStatus.actualBaseUrl?.replace(/\/+$/, "");
    if (expected && actual && expected !== actual) {
      messages.push(
        t("claudeDesktop.statusBaseUrlMismatch", { expected, actual }),
      );
    }
    return messages;
  }, [appId, claudeDesktopStatus, t]);

  const membershipPending =
    (appId === "opencode" && opencodeLivePending) ||
    (appId === "openclaw" && openclawLivePending) ||
    (appId === "hermes" && hermesLivePending) ||
    (appId === "pi" && piLivePending);
  if (isLoading || (membershipPending && sortedProviders.length > 0)) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="w-full border border-dashed rounded-lg h-28 border-muted-foreground/40 bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (sortedProviders.length === 0 && !session) {
    return (
      <ProviderEmptyState
        appId={appId}
        onCreate={onCreate}
        onImport={
          session || appId === "mcode"
            ? undefined
            : () => importMutation.mutate()
        }
      />
    );
  }

  const renderProviderCards = (list: Provider[]) => (
    <div className="space-y-4">
      {list.map((provider) => {
        const isOmo = provider.category === "omo";
        const isOmoSlim = provider.category === "omo-slim";
        const isOmoCurrent = isOmo && provider.id === (currentOmoId || "");
        const isOmoSlimCurrent =
          isOmoSlim && provider.id === (currentOmoSlimId || "");
        const isHermesCurrent =
          appId === "hermes" && hermesCurrentProviderId === provider.id;
        return (
          <ProviderCard
            key={provider.id}
            provider={provider}
            isCurrent={
              isOmo
                ? isOmoCurrent
                : isOmoSlim
                  ? isOmoSlimCurrent
                  : appId === "hermes"
                    ? isHermesCurrent
                    : provider.id === currentProviderId
            }
            appId={appId}
            isInConfig={isProviderInConfig(provider.id)}
            isOmo={isOmo}
            isOmoSlim={isOmoSlim}
            onSwitch={onSwitch}
            onEdit={onEdit}
            onDelete={onDelete}
            onRemoveFromConfig={onRemoveFromConfig}
            onDisableOmo={onDisableOmo}
            onDisableOmoSlim={onDisableOmoSlim}
            onDuplicate={onDuplicate}
            onConfigureUsage={onConfigureUsage ?? (() => undefined)}
            onOpenWebsite={onOpenWebsite}
            onOpenTerminal={onOpenTerminal}
            onTest={handleTest}
            isTesting={isChecking(provider.id)}
            isProxyRunning={isProxyRunning}
            isProxyTakeover={isProxyTakeover}
            deleteDisabled={
              provider.id === modeView?.directProviderId ||
              (provider.id === modeView?.routeProviderId &&
                modeView?.mode !== "direct")
            }
            aggregation={
              modeView?.mode === "aggregation"
                ? {
                    member: modeView.aggregation.members.some(
                      (m) => m.providerId === provider.id,
                    ),
                    default:
                      !session && provider.id === modeView.routeProviderId,
                    disabled:
                      modePending ||
                      !modeView.eligibleProviderIds.includes(provider.id),
                    onToggle: () =>
                      onAggregationMember?.(
                        provider.id,
                        !modeView.aggregation.members.some(
                          (m) => m.providerId === provider.id,
                        ),
                      ),
                    onDefault: session
                      ? undefined
                      : () => onAggregationDefault?.(provider.id),
                  }
                : undefined
            }
            isAutoFailoverEnabled={isFailoverModeActive}
            failoverPriority={getFailoverPriority(provider.id)}
            isInFailoverQueue={isInFailoverQueue(provider.id)}
            onToggleFailover={(enabled) =>
              handleToggleFailover(provider.id, enabled)
            }
            activeProviderId={activeProviderId}
            isDefaultModel={
              appId === "hermes"
                ? isHermesCurrent
                : isProviderDefaultModel(provider.id)
            }
            onSetAsDefault={
              onSetAsDefault ? () => onSetAsDefault(provider) : undefined
            }
          />
        );
      })}
    </div>
  );

  const renderProviderList = () => renderProviderCards(filteredProviders);

  const renderUnitPager = (
    total: number,
    currentPage: number,
    totalPages: number,
  ) =>
    total > UNIT_PAGE_SIZE ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-border-default bg-background/60 px-4 py-3">
        <span className="text-xs text-muted-foreground">
          共 {total} 个 · 每页 {UNIT_PAGE_SIZE} 个
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => setUnitPage(currentPage - 1)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            上一页
          </Button>
          <span className="text-xs text-muted-foreground">
            第 {currentPage} / {totalPages} 页
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => setUnitPage(currentPage + 1)}
          >
            下一页
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>
    ) : null;

  const renderUnitWorkbench = () => {
    const owned = filteredProviders.filter(
      (provider) => !provider.unitResource || provider.unitResource.owned,
    );
    const shared = filteredProviders.filter(
      (provider) => provider.unitResource && !provider.unitResource.owned,
    );
    const items =
      unitTab === "owned" ? owned : unitTab === "shared" ? shared : [];
    const total =
      unitTab === "library" ? unitLibraryEntries.length : items.length;
    const totalPages = Math.max(1, Math.ceil(total / UNIT_PAGE_SIZE));
    const currentPage = Math.min(unitPage, totalPages);
    const offset = (currentPage - 1) * UNIT_PAGE_SIZE;
    const pageItems = items.slice(offset, offset + UNIT_PAGE_SIZE);
    const pageLibraryEntries = unitLibraryEntries.slice(
      offset,
      offset + UNIT_PAGE_SIZE,
    );

    return (
      <div className="space-y-5">
        <PageTabs
          aria-label="供应商分类"
          value={unitTab}
          onValueChange={setUnitTab}
          items={[
            {
              value: "library",
              label: `供应商库 ${unitLibraryEntries.length}`,
            },
            { value: "owned", label: `我的供应商 ${owned.length}` },
            {
              value: "shared",
              label: `共享给我的供应商 ${shared.length}`,
            },
          ]}
        />

        {unitTab === "library" ? (
          pageLibraryEntries.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {pageLibraryEntries.map((entry) => {
                const resource = entry.unitResource;
                return (
                  <div
                    key={entry.id}
                    className="glass-card flex flex-col gap-3 rounded-[22px] border border-border-default p-4"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      {entry.icon ? (
                        <ProviderIcon
                          icon={entry.icon}
                          name={entry.name}
                          size={20}
                          className="mt-0.5 flex-shrink-0"
                        />
                      ) : (
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-border-default bg-muted/60 text-xs font-semibold text-muted-foreground">
                          {entry.name.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {resource.ownerName} 的 {entry.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {resource.modelCount ?? 0} 个模型
                          {resource.official ? " · 官方账号" : ""}
                        </div>
                      </div>
                    </div>
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <span className="theme-chip-neutral inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium">
                        {resource.owned ? "我上传的" : "其他用户上传"}
                      </span>
                      {resource.disabled && (
                        <span className="theme-chip-neutral inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium">
                          已停用
                        </span>
                      )}
                      {!resource.owned &&
                        (resource.myApplication === "pending" ? (
                          <span className="theme-chip-primary inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium">
                            待审批
                          </span>
                        ) : resource.accessible &&
                          isUnlimitedBudget(resource.myBudget) ? (
                          <span className="text-[11px] text-muted-foreground">
                            已授权 · 额度不限
                          </span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {resource.accessible && (
                              <span className="text-[11px] text-muted-foreground">
                                当前额度 {budgetLabel(resource.myBudget)}
                              </span>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setApplyTarget(entry);
                                setApplyBudget({});
                                setApplyMessage("");
                              }}
                            >
                              {resource.accessible ? "申请追加额度" : "申请使用"}
                            </Button>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-border-default px-4 py-8 text-center text-sm text-muted-foreground">
              还没有任何用户发布供应商。
            </div>
          )
        ) : pageItems.length ? (
          renderProviderCards(pageItems)
        ) : (
          <div className="rounded-[22px] border border-dashed border-border-default px-4 py-8 text-center text-sm text-muted-foreground">
            {unitTab === "owned"
              ? "还没有自己的供应商。"
              : "暂时没有共享给你的供应商。"}
          </div>
        )}

        {renderUnitPager(total, currentPage, totalPages)}
      </div>
    );
  };

  return (
    <div className="mt-4 space-y-4">
      {claudeDesktopStatusMessages.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("claudeDesktop.statusTitle")}
          </div>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed">
            {claudeDesktopStatusMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="glass-card rounded-[30px] border border-border-default p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {t("provider.workspaceLabel", {
                defaultValue: "Provider Workspace",
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {t("provider.listTitle", {
                  defaultValue: "供应商工作台",
                })}
              </h2>
              <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                {t("provider.countSummary", {
                  count: sortedProviders.length,
                  defaultValue: "{{count}} 个配置",
                })}
              </span>
              {searchTerm.trim() && (
                <span className="theme-chip-primary inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                  {t("provider.filteredCount", {
                    count: filteredProviders.length,
                    defaultValue: "筛选后 {{count}} 个",
                  })}
                </span>
              )}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {searchTerm.trim()
                ? t("provider.searchSummary", {
                    defaultValue:
                      "正在按名称、备注和 URL 过滤当前应用下的供应商配置。",
                  })
                : t("provider.workspaceDescription", {
                    defaultValue:
                      "集中查看、筛选和整理当前应用的供应商配置，常用操作可以直接在这里完成。",
                  })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={
                isSearchOpen || searchTerm.trim() ? "default" : "outline"
              }
              className="min-w-[8rem]"
              onClick={() => setIsSearchOpen(true)}
            >
              <Search className="mr-2 h-4 w-4" />
              {searchTerm.trim()
                ? t("provider.searching", {
                    defaultValue: "筛选中",
                  })
                : t("provider.search", {
                    defaultValue: "搜索",
                  })}
            </Button>
            {onCreate && (
              <Button
                type="button"
                className="theme-primary-solid min-w-[8rem]"
                onClick={onCreate}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t("provider.addProvider")}
              </Button>
            )}
          </div>
        </div>

        {searchTerm.trim() && (
          <div className="mt-4 flex flex-col gap-2 rounded-[22px] border border-border-default bg-background/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {t("provider.searchActiveHint", {
                count: filteredProviders.length,
                defaultValue: "当前显示 {{count}} 个匹配项。",
              })}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start sm:justify-center"
              onClick={() => setSearchTerm("")}
            >
              {t("common.clear", { defaultValue: "清空" })}
            </Button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isSearchOpen && (
          <motion.div
            key="provider-search"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="fixed left-1/2 top-[7.75rem] z-40 w-[min(92vw,28rem)] -translate-x-1/2 sm:right-6 sm:left-auto sm:translate-x-0"
          >
            <div className="p-4 space-y-3 border shadow-md rounded-2xl border-white/10 bg-background/95 shadow-black/20 backdrop-blur-md">
              <div className="relative flex items-center gap-2">
                <Search className="absolute w-4 h-4 -translate-y-1/2 pointer-events-none left-3 top-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t("provider.searchPlaceholder", {
                    defaultValue: "Search name, notes, or URL...",
                  })}
                  aria-label={t("provider.searchAriaLabel", {
                    defaultValue: "Search providers",
                  })}
                  className="pr-16 pl-9"
                />
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute text-xs -translate-y-1/2 right-11 top-1/2"
                    onClick={() => setSearchTerm("")}
                  >
                    {t("common.clear", { defaultValue: "Clear" })}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => setIsSearchOpen(false)}
                  aria-label={t("provider.searchCloseAriaLabel", {
                    defaultValue: "Close provider search",
                  })}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {t("provider.searchScopeHint", {
                    defaultValue: "Matches provider name, notes, and URL.",
                  })}
                </span>
                <span>
                  {t("provider.searchCloseHint", {
                    defaultValue: "Press Esc to close",
                  })}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {session ? (
        renderUnitWorkbench()
      ) : filteredProviders.length === 0 ? (
        <div className="glass-card rounded-[28px] border border-dashed border-border-default px-6 py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
            <Search className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="mt-4 text-base font-semibold text-foreground">
            {t("provider.noSearchResults", {
              defaultValue: "No providers match your search.",
            })}
          </div>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {t("provider.noSearchResultsHint", {
              defaultValue:
                "试试更短的关键字，或者清空筛选后重新查看全部供应商。",
            })}
          </p>
        </div>
      ) : (
        renderProviderList()
      )}

      <Dialog
        open={Boolean(applyTarget)}
        onOpenChange={(open) => {
          if (!open) setApplyTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>申请使用供应商</DialogTitle>
          </DialogHeader>
          {applyTarget && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {applyTarget.unitResource.ownerName} 的 {applyTarget.name}
                ：提交后由提供者审批，通过后按授权额度使用。
              </p>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ["requests", "请求次数"],
                    ["tokens", "Token 数量"],
                    ["credits", "点数"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="space-y-1 text-xs text-muted-foreground"
                  >
                    {label}
                    <Input
                      type="number"
                      min={0}
                      placeholder="不限"
                      value={applyBudget[key] ?? ""}
                      onChange={(event) =>
                        setApplyBudget({
                          ...applyBudget,
                          [key]:
                            event.target.value === ""
                              ? null
                              : Number(event.target.value),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="block space-y-1 text-xs text-muted-foreground">
                申请说明（可选）
                <Input
                  value={applyMessage}
                  placeholder="例如：用于日常开发，预计每月 2000 万 token"
                  onChange={(event) => setApplyMessage(event.target.value)}
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setApplyTarget(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  disabled={applyBusy}
                  onClick={() => void submitApplication()}
                >
                  {applyBusy ? "提交中…" : "提交申请"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        isOpen={showStreamCheckConfirm}
        variant="info"
        title={t("confirm.streamCheck.title")}
        message={t("confirm.streamCheck.message")}
        confirmText={t("confirm.streamCheck.confirm")}
        onConfirm={() => void handleStreamCheckConfirm()}
        onCancel={() => {
          setShowStreamCheckConfirm(false);
          setPendingTestProvider(null);
        }}
      />
    </div>
  );
}
