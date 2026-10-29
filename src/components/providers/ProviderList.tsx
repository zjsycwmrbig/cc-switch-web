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
  RefreshCw,
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
import { tierLabel } from "@/components/SubscriptionQuotaFooter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  unit,
  formatDate,
  formatNumber,
  type Budget,
} from "@/components/unit/client";
import { LimitField } from "@/components/unit/LimitField";
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

/** 供应商库每页 12 个，我的供应商每页 5 个，共享给我的每页 5 个。 */
const UNIT_PAGE_SIZE: Record<UnitProviderTab, number> = {
  library: 12,
  owned: 5,
  shared: 5,
};

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
    visibleModels?: Array<{ slug: string; display_name?: string }>;
    visibleModelCount?: number;
    usage7d?: { requests: number; tokens: number; costCredits: number };
    myApplication?: string | null;
    myBudget?: Budget;
    myExpiresAt?: number | null;
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
  onCreate?: (mode?: "public" | "private") => void;
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
  /** 官方账号用量的档位名来自后端（`five_hour` 等），已知档位换成本地化写法 */
  const planLabel = (name?: string | null) => (name ? tierLabel(t, name) : "");
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
  const [unitOwnerFilter, setUnitOwnerFilter] = useState("");
  const [unitModelFilter, setUnitModelFilter] = useState("");
  const [unitApplyOnly, setUnitApplyOnly] = useState(false);
  const [unitUsage, setUnitUsage] = useState<Record<string, any>>({});
  const [usageLoading, setUsageLoading] = useState<Record<string, boolean>>({});
  const refreshUnitUsage = async (resourceId: string) => {
    setUsageLoading((old) => ({ ...old, [resourceId]: true }));
    try {
      const value = await unit(`/ui/library/${appId}/${resourceId}/usage`);
      setUnitUsage((old) => ({ ...old, [resourceId]: value }));
    } catch (error) {
      setUnitUsage((old) => ({
        ...old,
        [resourceId]: {
          success: false,
          error: error instanceof Error ? error.message : "余额/用量查询失败",
        },
      }));
    } finally {
      setUsageLoading((old) => ({ ...old, [resourceId]: false }));
    }
  };
  const [expandedModels, setExpandedModels] = useState<string | null>(null);
  const [modelPage, setModelPage] = useState<Record<string, number>>({});
  const pendingPublicCreate = useRef(false);
  const knownProviderIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    setUnitPage(1);
    setSearchTerm("");
    setUnitOwnerFilter("");
    setUnitModelFilter("");
    setUnitApplyOnly(false);
  }, [unitTab]);
  const [applyTarget, setApplyTarget] = useState<UnitLibraryProvider | null>(
    null,
  );
  const [applyExpires, setApplyExpires] = useState("");
  const [applyBudget, setApplyBudget] = useState<Budget>({});
  const [applyModels, setApplyModels] = useState<string[]>([]);
  const [applyModelSearch, setApplyModelSearch] = useState("");
  const [applyModelPage, setApplyModelPage] = useState(1);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);

  // 供应商模型可能很多，申请弹窗里按搜索 + 分页展示，避免溢出。
  const applyVisibleModels = applyTarget?.unitResource.visibleModels ?? [];
  const applyModelKeyword = applyModelSearch.trim().toLowerCase();
  const applyFilteredModels = applyModelKeyword
    ? applyVisibleModels.filter((model) =>
        `${model.slug} ${model.display_name ?? ""}`
          .toLowerCase()
          .includes(applyModelKeyword),
      )
    : applyVisibleModels;
  const APPLY_MODEL_PAGE_SIZE = 24;
  const applyModelPages = Math.max(
    1,
    Math.ceil(applyFilteredModels.length / APPLY_MODEL_PAGE_SIZE),
  );
  const applyModelCurrent = Math.min(applyModelPage, applyModelPages);
  const applyModelPageItems = applyFilteredModels.slice(
    (applyModelCurrent - 1) * APPLY_MODEL_PAGE_SIZE,
    applyModelCurrent * APPLY_MODEL_PAGE_SIZE,
  );

  useEffect(() => {
    setApplyModelPage(1);
  }, [applyModelSearch, applyTarget?.unitResource.id]);
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
      .filter((entry) => {
        const resource = entry.unitResource;
        if (unitApplyOnly && (resource.accessible || resource.myApplication === "pending")) {
          return false;
        }
        if (unitOwnerFilter && resource.ownerName !== unitOwnerFilter) {
          return false;
        }
        if (
          unitModelFilter &&
          !(resource.visibleModels ?? []).some(
            (model) => model.slug === unitModelFilter,
          )
        ) {
          return false;
        }
        return (
          !keyword ||
          `${resource.ownerName} 的 ${entry.name}`
            .toLowerCase()
            .includes(keyword)
        );
      })
      .sort((a, b) =>
        `${a.unitResource.ownerName} 的 ${a.name}`.localeCompare(
          `${b.unitResource.ownerName} 的 ${b.name}`,
          "zh-Hans-CN",
        ),
      );
  }, [searchTerm, unitLibrary, unitOwnerFilter, unitModelFilter, unitApplyOnly]);

  const unitOwnerOptions = useMemo(
    () =>
      [
        ...new Set(
          Object.values(unitLibrary?.providers ?? {}).map(
            (entry) => entry.unitResource.ownerName,
          ),
        ),
      ].sort(),
    [unitLibrary],
  );
  const unitModelOptions = useMemo(
    () =>
      [
        ...new Set(
          Object.values(unitLibrary?.providers ?? {}).flatMap((entry) =>
            (entry.unitResource.visibleModels ?? []).map((model) => model.slug),
          ),
        ),
      ].sort(),
    [unitLibrary],
  );


  // “增加公共供应商”创建完成后自动发布到供应商库。
  useEffect(() => {
    if (!pendingPublicCreate.current) return;
    const created = Object.values(providers).find(
      (provider) => !knownProviderIds.current.has(provider.id),
    );
    if (created?.unitResource) {
      pendingPublicCreate.current = false;
      onAggregationMember?.(created.id, true);
      toast.success(`${created.name} 已发布到供应商库`);
    }
  }, [providers, onAggregationMember]);

  // 只在用户还没手动切过 tab 时自动跳到供应商库；否则空 tab（我的供应商 0）会被反复弹回。
  const unitTabTouched = useRef(false);
  useEffect(() => {
    if (!session || unitTabTouched.current) return;
    const ownedCount = filteredProviders.filter(
      (provider) => !provider.unitResource || provider.unitResource.owned,
    ).length;
    if (unitTab === "owned" && ownedCount === 0 && unitLibraryEntries.length > 0) {
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
          models: applyModels,
          message: applyMessage,
          expiresAt: applyExpires
            ? Math.floor(new Date(applyExpires).getTime() / 1000)
            : null,
        },
      );
      toast.success(
        result.state === "approved"
          ? "已按免审规则自动通过，可直接使用"
          : "申请已提交，等待提供者审批",
      );
      setApplyTarget(null);
      setApplyExpires("");
      setApplyBudget({});
      setApplyModels([]);
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
                    joinLabel: session ? "上架供应商市场" : undefined,
                    memberLabel: session ? "已上架" : undefined,
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
    pageSize: number,
  ) =>
    total > pageSize ? (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-border-default bg-background/60 px-4 py-3">
        <span className="text-xs text-muted-foreground">
          共 {total} 个 · 每页 {pageSize} 个
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

  /** 共享给我的供应商：卡片直接展示额度、截止时间与可用的模型范围。 */
  const renderSharedCards = (list: Provider[]) => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map((provider) => {
        const resource = provider.unitResource;
        if (!resource) return null;
        const budget = resource.myBudget || {};
        return (
          <article
            key={provider.id}
            className="glass-card flex flex-col gap-3 rounded-[22px] border border-border-default p-4"
          >
            <header className="flex min-w-0 items-start gap-3">
              <ProviderIcon
                icon={provider.icon}
                name={provider.name}
                size={20}
                className="mt-0.5 flex-shrink-0"
              />
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">
                  <span className="font-medium text-primary">
                    {resource.ownerName}
                  </span>
                  <span className="font-normal text-muted-foreground"> 的 </span>
                  {provider.name}
                </h3>
                <p className="truncate text-xs text-muted-foreground">
                  {resource.appType?.toUpperCase()} · 共享给我
                </p>
              </div>
            </header>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-border-default px-2.5 py-2">
                <div className="text-muted-foreground">请求次数</div>
                <div className="font-medium text-foreground">
                  {budget.requests == null
                    ? "不限"
                    : `${formatNumber(budget.requests)} 次`}
                </div>
              </div>
              <div className="rounded-lg border border-border-default px-2.5 py-2">
                <div className="text-muted-foreground">Token 数量</div>
                <div className="font-medium text-foreground">
                  {budget.tokens == null
                    ? "不限"
                    : `${formatNumber(budget.tokens)} Token`}
                </div>
              </div>
              <div className="rounded-lg border border-border-default px-2.5 py-2">
                <div className="text-muted-foreground">时间截止</div>
                <div className="font-medium text-foreground">
                  {resource.myExpiresAt
                    ? formatDate(resource.myExpiresAt)
                    : "不限时间"}
                </div>
              </div>
              <div className="rounded-lg border border-border-default px-2.5 py-2">
                <div className="text-muted-foreground">可用模型</div>
                <div className="font-medium text-foreground">
                  {resource.models.length
                    ? `${resource.models.length} 个`
                    : "暂无可用模型"}
                </div>
              </div>
            </div>
            <footer className="mt-auto flex flex-wrap items-center gap-2">
              <span className="theme-chip-neutral inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium">
                {resource.grantSource === "policy"
                  ? "公开默认额度"
                  : "单独授权"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {resource.health === "ready" ? "就绪" : "可用"}
              </span>
            </footer>
          </article>
        );
      })}
    </div>
  );

  const renderUnitWorkbench = () => {
    const owned = filteredProviders.filter(
      (provider) => !provider.unitResource || provider.unitResource.owned,
    );
    const shared = filteredProviders.filter(
      (provider) => provider.unitResource && !provider.unitResource.owned,
    );
    const items =
      unitTab === "owned" ? owned : unitTab === "shared" ? shared : [];
    const pageSize = UNIT_PAGE_SIZE[unitTab];
    const total =
      unitTab === "library" ? unitLibraryEntries.length : items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(unitPage, totalPages);
    const offset = (currentPage - 1) * pageSize;
    const pageItems = items.slice(offset, offset + pageSize);
    const pageLibraryEntries = unitLibraryEntries.slice(
      offset,
      offset + pageSize,
    );

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border-default bg-muted/30 p-1.5">
          {[
            ["library", "供应商库", unitLibraryEntries.length],
            ["owned", "我的供应商", sortedProviders.filter((p) => p.unitResource?.owned).length],
            ["shared", "共享给我的供应商", sortedProviders.filter((p) => p.unitResource && !p.unitResource.owned).length],
          ].map(([value, label, count]) => (
            <button
              key={String(value)}
              type="button"
              onClick={() => {
                unitTabTouched.current = true;
                setUnitTab(value as UnitProviderTab);
              }}
              className={
                unitTab === value
                  ? "rounded-xl bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm ring-1 ring-border-default"
                  : "rounded-xl px-4 py-2 text-sm text-muted-foreground hover:bg-background/60 hover:text-foreground"
              }
            >
              {label} <span className="ml-1 text-xs opacity-70">{count}</span>
            </button>
          ))}
        </div>
        <div className="glass-card rounded-[24px] border border-border-default p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold text-foreground">
                {unitTab === "library" ? "供应商库" : unitTab === "owned" ? "我的供应商" : "共享给我的供应商"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {unitTab === "library"
                  ? "浏览所有用户发布的供应商，查看模型与用量后提交申请。"
                  : unitTab === "owned"
                    ? "管理自己的供应商：加入公共供应商后可被其他用户申请。"
                    : "其他用户授权给你的供应商，可查看额度、截止时间与可用模型。"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {unitTab === "library" && onCreate && (
                <Button type="button" variant="outline" onClick={() => setUnitApplyOnly((v) => !v)}>
                  {unitApplyOnly ? "显示全部" : "申请可用供应商"}
                </Button>
              )}
              {unitTab === "owned" && onCreate && (
                <>
                  <Button type="button" onClick={() => onCreate("private")}>
                    <Plus className="mr-2 h-4 w-4" />
                    新建自己供应商
                  </Button>
                </>
              )}
              {onCreate && unitTab !== "owned" && (
                <Button type="button" variant="outline" onClick={() => onCreate("public")}>
                  <Plus className="mr-2 h-4 w-4" />
                  增加公共供应商
                </Button>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="搜索供应商或用户" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
            </div>
            {unitTab === "library" && (
              <>
                <select className="h-9 rounded-md border border-border-default bg-background px-2 text-xs" value={unitOwnerFilter} onChange={(event) => setUnitOwnerFilter(event.target.value)}>
                  <option value="">所有用户</option>
                  {unitOwnerOptions.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
                </select>
                <select className="h-9 max-w-[220px] rounded-md border border-border-default bg-background px-2 text-xs" value={unitModelFilter} onChange={(event) => setUnitModelFilter(event.target.value)}>
                  <option value="">所有模型</option>
                  {unitModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
              </>
            )}
          </div>
        </div>

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
                          <span className="font-medium text-primary">
                            {resource.ownerName}
                          </span>
                          <span className="font-normal text-muted-foreground"> 的 </span>
                          {entry.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {resource.visibleModelCount ??
                            resource.visibleModels?.length ??
                            resource.modelCount ??
                            0}{" "}
                          个可见模型
                          {resource.official ? " · 官方账号" : ""}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-border-default px-2.5 py-2">
                        <div className="text-muted-foreground">近 7 天请求</div>
                        <div className="font-medium text-foreground">
                          {formatNumber(resource.usage7d?.requests ?? 0)} 次
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-default px-2.5 py-2">
                        <div className="text-muted-foreground">近 7 天 Token</div>
                        <div className="font-medium text-foreground">
                          {formatNumber(resource.usage7d?.tokens ?? 0)}
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border-default px-3 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-muted-foreground">余额 / 用量</div>
                        <button
                          type="button"
                          title="刷新余额/用量"
                          aria-label="刷新余额/用量"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-border-default text-muted-foreground hover:text-foreground"
                          disabled={usageLoading[resource.id]}
                          onClick={() => void refreshUnitUsage(resource.id)}
                        >
                          <RefreshCw size={12} className={usageLoading[resource.id] ? "animate-spin" : ""} />
                        </button>
                      </div>
                      <div className="mt-1.5 space-y-2">
                        {(() => {
                          const u = unitUsage[resource.id];
                          if (usageLoading[resource.id]) {
                            return <div className="text-xs text-muted-foreground">查询中…</div>;
                          }
                          if (!u) {
                            return <div className="text-xs text-muted-foreground">点击刷新余额/用量</div>;
                          }
                          if (!u.success) {
                            return <div className="text-xs text-muted-foreground">{u.error || "未配置"}</div>;
                          }
                          const data = (u.data ?? []) as any[];
                          if (!data.length) return <div className="text-xs text-muted-foreground">可用</div>;
                          return data.map((d: any, i: number) => {
                            const n = typeof d.remaining === "number" ? d.remaining : typeof d.used === "number" ? d.used : null;
                            const pct = d.unit === "%" ? Math.max(0, Math.min(100, n ?? 0)) : null;
                            return (
                              <div key={`${d.planName ?? "plan"}-${i}`} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="truncate text-muted-foreground">{planLabel(d.planName) || "余额"}</span>
                                  <span className="font-mono text-foreground">
                                    {n == null ? "—" : `${n.toFixed(d.unit === "%" ? 1 : 2)}${d.unit === "%" ? "%" : " " + (d.unit ?? "")}`}
                                  </span>
                                </div>
                                {pct != null && (
                                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                    {(resource.visibleModels?.length ?? 0) > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs text-muted-foreground">
                          可用模型 {resource.visibleModelCount ?? resource.visibleModels?.length ?? 0} 个：
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(() => {
                            const models = resource.visibleModels ?? [];
                            const expanded = expandedModels === entry.id;
                            const perPage = 10;
                            const pages = Math.max(1, Math.ceil(models.length / perPage));
                            const page = Math.min(modelPage[entry.id] ?? 1, pages);
                            const shown = expanded
                              ? models.slice((page - 1) * perPage, page * perPage)
                              : models.slice(0, 3);
                            return (
                              <>
                                {shown.map((model) => (
                                  <span
                                    key={model.slug}
                                    className="rounded-full border border-border-default px-2 py-0.5 text-[10px] text-muted-foreground"
                                  >
                                    {model.display_name || model.slug}
                                  </span>
                                ))}
                                {models.length > 3 && (
                                  <button
                                    type="button"
                                    className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] text-primary"
                                    onClick={() => setExpandedModels(expanded ? null : entry.id)}
                                  >
                                    {expanded ? "收起" : `展开全部 ${models.length} 个`}
                                  </button>
                                )}
                                {expanded && pages > 1 && (
                                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <button
                                      type="button"
                                      disabled={page <= 1}
                                      onClick={() => setModelPage((old) => ({ ...old, [entry.id]: page - 1 }))}
                                    >
                                      上一页
                                    </button>
                                    {page}/{pages}
                                    <button
                                      type="button"
                                      disabled={page >= pages}
                                      onClick={() => setModelPage((old) => ({ ...old, [entry.id]: page + 1 }))}
                                    >
                                      下一页
                                    </button>
                                  </span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
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
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            {resource.accessible && (
                              <span className="text-[11px] text-muted-foreground">
                                已授权 ·{" "}
                                {isUnlimitedBudget(resource.myBudget)
                                  ? "额度不限"
                                  : `额度 ${budgetLabel(resource.myBudget)}`}
                                {" · "}
                                {resource.myExpiresAt
                                  ? `截止 ${formatDate(resource.myExpiresAt)}`
                                  : "不限时间"}
                              </span>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setApplyTarget(entry);
                                setApplyExpires("");
                                setApplyBudget({});
                                setApplyModels([]);
                                setApplyMessage("");
                              }}
                            >
                              {resource.accessible ? "申请调整授权" : "申请使用"}
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
          unitTab === "shared" ? (
            renderSharedCards(pageItems)
          ) : (
            renderProviderCards(pageItems)
          )
        ) : (
          <div className="rounded-[22px] border border-dashed border-border-default px-4 py-8 text-center text-sm text-muted-foreground">
            {unitTab === "owned"
              ? "还没有自己的供应商。"
              : "暂时没有共享给你的供应商。"}
          </div>
        )}

        {renderUnitPager(total, currentPage, totalPages, pageSize)}
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
        <DialogContent className="sm:max-w-2xl p-6 sm:p-7">
          <DialogHeader>
            <DialogTitle>申请使用供应商</DialogTitle>
          </DialogHeader>
          {applyTarget && (
            <div className="space-y-6 py-2">
              <p className="text-sm leading-6 text-muted-foreground">
                {applyTarget.unitResource.ownerName} 的 {applyTarget.name}
                ：提交后由提供者审批，可以按你的条件通过，也可以调整条件后通过；留空表示不限。
              </p>
              <div className="space-y-5 rounded-xl border border-border-default p-4">
                <div className="grid grid-cols-1 gap-5">
                <div className="space-y-2 text-xs text-muted-foreground">
                  请求次数
                  <LimitField
                    kind="requests"
                    value={applyBudget.requests}
                    change={(requests) =>
                      setApplyBudget({ ...applyBudget, requests })
                    }
                  />
                </div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  Token 数量
                  <LimitField
                    kind="tokens"
                    value={applyBudget.tokens}
                    change={(tokens) => setApplyBudget({ ...applyBudget, tokens })}
                  />
                </div>
              </div>
                <label className="block space-y-2 text-xs text-muted-foreground">
                  时间截止（留空表示不限时间）
                  <Input
                    type="datetime-local"
                    value={applyExpires}
                    onChange={(event) => setApplyExpires(event.target.value)}
                  />
                </label>
              </div>
              {applyVisibleModels.length > 0 && (
                <div className="space-y-3 rounded-xl border border-border-default p-4 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>模型范围（留空表示全部可见模型）</span>
                    <span>
                      已选 {applyModels.length} 个 · 可见{" "}
                      {applyVisibleModels.length} 个
                    </span>
                  </div>
                  {applyVisibleModels.length > APPLY_MODEL_PAGE_SIZE && (
                    <Input
                      placeholder="搜索模型名称"
                      value={applyModelSearch}
                      onChange={(event) =>
                        setApplyModelSearch(event.target.value)
                      }
                    />
                  )}
                  <div className="flex max-h-[190px] flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border-default p-2">
                    {applyModelPageItems.map((model) => {
                      const active = applyModels.includes(model.slug);
                      return (
                        <button
                          key={model.slug}
                          type="button"
                          onClick={() =>
                            setApplyModels(
                              active
                                ? applyModels.filter(
                                    (slug) => slug !== model.slug,
                                  )
                                : [...applyModels, model.slug],
                            )
                          }
                          className={`rounded-full border px-2.5 py-1 text-[11px] ${
                            active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border-default text-muted-foreground"
                          }`}
                        >
                          {model.display_name || model.slug}
                        </button>
                      );
                    })}
                    {!applyModelPageItems.length && (
                      <span className="px-1 py-1">没有匹配的模型</span>
                    )}
                  </div>
                  {applyModels.length > 0 && (
                    <p className="truncate">
                      已选：
                      {applyModels
                        .map(
                          (slug) =>
                            applyVisibleModels.find(
                              (model) => model.slug === slug,
                            )?.display_name || slug,
                        )
                        .join("、")}
                    </p>
                  )}
                  {(applyModelPages > 1 || applyModels.length > 0) && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        {applyModelPages > 1 && (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={applyModelCurrent <= 1}
                              onClick={() =>
                                setApplyModelPage(applyModelCurrent - 1)
                              }
                            >
                              上一页
                            </Button>
                            <span>
                              {applyModelCurrent} / {applyModelPages}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={applyModelCurrent >= applyModelPages}
                              onClick={() =>
                                setApplyModelPage(applyModelCurrent + 1)
                              }
                            >
                              下一页
                            </Button>
                          </>
                        )}
                      </div>
                      {applyModels.length > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setApplyModels([])}
                        >
                          清空选择
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <label className="block space-y-2 text-xs text-muted-foreground">
                申请说明（可选）
                <Input
                  value={applyMessage}
                  placeholder="例如：用于日常开发，预计每月 2000 万 token"
                  onChange={(event) => setApplyMessage(event.target.value)}
                />
              </label>
              <div className="flex justify-end gap-3 pt-1">
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
