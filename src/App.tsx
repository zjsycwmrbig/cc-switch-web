import { useUnitSession } from "@/components/unit/session";
import { UnitPanel } from "@/components/unit/UnitApp";
import { WebSidebar } from "@/components/shell/WebSidebar";
import { APP_DISPLAY_NAME } from "@/config/appMeta";
import type { ProviderEditorSave } from "@/lib/api/providers";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, ArrowLeft } from "lucide-react";
import type { Provider, VisibleApps } from "@/types";
import { useProvidersQuery, useSettingsQuery } from "@/lib/query";
import { hermesApi, providersApi, settingsApi, type AppId } from "@/lib/api";
import { checkAllEnvConflicts, checkEnvConflicts } from "@/lib/api/env";
import { useProviderActions } from "@/hooks/useProviderActions";
import {
  hermesKeys,
  useHermesHealth,
  useOpenHermesWebUI,
} from "@/hooks/useHermes";
import { openclawKeys, useOpenClawHealth } from "@/hooks/useOpenClaw";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { useLastValidValue } from "@/hooks/useLastValidValue";
import { extractErrorMessage } from "@/utils/errorUtils";
import { isTextEditableTarget } from "@/utils/domUtils";
import { ProviderList } from "@/components/providers/ProviderList";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EnvWarningBanner } from "@/components/env/EnvWarningBanner";
import { FirstRunNoticeDialog } from "@/components/FirstRunNoticeDialog";
import { AppModePanel } from "@/components/proxy/AppModePanel";
import { useAppMode, supportsAppMode } from "@/hooks/useAppMode";
import { RoutingActivationBrand } from "@/components/proxy/RoutingActivationBrand";
import { FailoverToggle } from "@/components/proxy/FailoverToggle";
import { Button } from "@/components/ui/button";
import {
  useDisableCurrentOmo,
  useDisableCurrentOmoSlim,
} from "@/lib/query/omo";
import OpenClawHealthBanner from "@/components/openclaw/OpenClawHealthBanner";
import HermesHealthBanner from "@/components/hermes/HermesHealthBanner";

// 首屏只展示供应商列表；其余视图与弹窗按需加载，避免首屏包过大。
const AddProviderDialog = lazy(() =>
  import("@/components/providers/AddProviderDialog").then((m) => ({
    default: m.AddProviderDialog,
  })),
);
const EditProviderDialog = lazy(() =>
  import("@/components/providers/EditProviderDialog").then((m) => ({
    default: m.EditProviderDialog,
  })),
);
const DeepLinkImportDialog = lazy(() =>
  import("@/components/deeplink/DeepLinkImportDialog").then((m) => ({
    default: m.DeepLinkImportDialog,
  })),
);
const UsageScriptModal = lazy(() => import("@/components/UsageScriptModal"));
const UsageDashboard = lazy(() =>
  import("@/components/usage/UsageDashboard").then((m) => ({
    default: m.UsageDashboard,
  })),
);

type View =
  | "providers"
  | "models"
  | "allocations"
  | "profile"
  | "admin"
  | "usage";

const DRAG_BAR_HEIGHT = 0; // px
const HEADER_HEIGHT = 64; // px
const STORAGE_KEY = "cc-switch-last-app";
const VALID_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
  "mcode",
];

const getInitialApp = (): AppId => {
  const saved = localStorage.getItem(STORAGE_KEY) as AppId | null;
  if (saved && VALID_APPS.includes(saved)) {
    return saved;
  }
  return "claude";
};

const VIEW_STORAGE_KEY = "cc-switch-last-view";
const VALID_VIEWS: View[] = [
  "providers",
  "models",
  "allocations",
  "profile",
  "admin",
  "usage",
];

const getInitialView = (): View => {
  const saved = localStorage.getItem(VIEW_STORAGE_KEY) as View | null;
  if (saved && VALID_VIEWS.includes(saved)) {
    return saved;
  }
  return "providers";
};

function App() {
  const session = useUnitSession();
  const isAdmin = !session || session.me.user.role === "admin";
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeApp, setActiveApp] = useState<AppId>(() => {
    const saved = session
      ? (localStorage.getItem(
          `${STORAGE_KEY}:${session.me.user.id}`,
        ) as AppId | null)
      : null;
    return saved && VALID_APPS.includes(saved) ? saved : getInitialApp();
  });
  const [currentView, setCurrentView] = useState<View>(() => {
    const saved = session
      ? (localStorage.getItem(
          `${VIEW_STORAGE_KEY}:${session.me.user.id}`,
        ) as View | null)
      : null;
    if (saved && VALID_VIEWS.includes(saved) && (saved !== "admin" || isAdmin))
      return saved;
    return session ? "providers" : getInitialView();
  });
  const [isAddOpen, setIsAddOpen] = useState(false);

  const handleViewChange = (nextView: View) => {
    setCurrentView(nextView);
  };

  useEffect(() => {
    localStorage.setItem(
      session ? `${VIEW_STORAGE_KEY}:${session.me.user.id}` : VIEW_STORAGE_KEY,
      currentView,
    );
  }, [currentView, session?.me.user.id]);
  useEffect(() => {
    if (session)
      localStorage.setItem(`${STORAGE_KEY}:${session.me.user.id}`, activeApp);
  }, [activeApp, session?.me.user.id]);

  const { data: settingsData } = useSettingsQuery();
  const visibleApps: VisibleApps = settingsData?.visibleApps ?? {
    claude: true,
    "claude-desktop": true,
    codex: true,
    gemini: true,
    grokbuild: true,
    opencode: true,
    openclaw: true,
    hermes: true,
    pi: true,
    mcode: true,
  };

  const getFirstVisibleApp = (): AppId => {
    if (visibleApps.claude) return "claude";
    if (visibleApps["claude-desktop"]) return "claude-desktop";
    if (visibleApps.codex) return "codex";
    if (visibleApps.gemini) return "gemini";
    if (visibleApps.grokbuild) return "grokbuild";
    if (visibleApps.opencode) return "opencode";
    if (visibleApps.openclaw) return "openclaw";
    if (visibleApps.hermes) return "hermes";
    if (visibleApps.pi) return "pi";
    return "claude"; // fallback
  };

  /** 多用户聚合只覆盖 Codex 与 Claude，其他应用的服务器配置仍由管理员维护。 */
  const sidebarApps = useMemo<VisibleApps>(() => {
    if (isAdmin) return visibleApps;
    return {
      ...visibleApps,
      "claude-desktop": false,
      gemini: false,
      grokbuild: false,
      opencode: false,
      openclaw: false,
      hermes: false,
      pi: false,
      mcode: false,
    };
  }, [isAdmin, visibleApps]);

  useEffect(() => {
    if (!visibleApps[activeApp]) {
      setActiveApp(getFirstVisibleApp());
    }
  }, [visibleApps, activeApp]);

  useEffect(() => {
    if (!isAdmin) return;
    const checkEnvOnStartup = async () => {
      try {
        const allConflicts = await checkAllEnvConflicts();
        const flatConflicts = Object.values(allConflicts).flat();

        if (flatConflicts.length > 0) {
          setEnvConflicts(flatConflicts);
          if (!sessionStorage.getItem("env_banner_dismissed")) {
            setShowEnvBanner(true);
          }
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on startup:",
          error,
        );
      }
    };

    void checkEnvOnStartup();
  }, []);

  useEffect(() => {
    if (!isAdmin || !["claude", "codex", "gemini"].includes(activeApp)) {
      return;
    }

    const checkEnvOnSwitch = async () => {
      try {
        if (activeApp === "mcode") return;
        const conflicts = await checkEnvConflicts(activeApp);
        if (conflicts.length === 0) {
          return;
        }

        setEnvConflicts((previous) => {
          const existingKeys = new Set(
            previous.map(
              (conflict) => `${conflict.varName}:${conflict.sourcePath}`,
            ),
          );
          const nextConflicts = conflicts.filter(
            (conflict) =>
              !existingKeys.has(`${conflict.varName}:${conflict.sourcePath}`),
          );
          return [...previous, ...nextConflicts];
        });

        if (!sessionStorage.getItem("env_banner_dismissed")) {
          setShowEnvBanner(true);
        }
      } catch (error) {
        console.error(
          "[App] Failed to check environment conflicts on app switch:",
          error,
        );
      }
    };

    void checkEnvOnSwitch();
  }, [activeApp]);

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [usageProvider, setUsageProvider] = useState<Provider | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    provider: Provider;
    action: "remove" | "delete";
  } | null>(null);
  const [envConflicts, setEnvConflicts] = useState<
    import("@/types/env").EnvConflict[]
  >([]);
  const [showEnvBanner, setShowEnvBanner] = useState(false);
  const [envBannerHeight, setEnvBannerHeight] = useState(0);

  useEffect(() => {
    setIsAddOpen(false);
    setEditingProvider(null);
    setUsageProvider(null);
    setConfirmAction(null);
  }, [activeApp, currentView]);

  const effectiveEditingProvider = useLastValidValue(editingProvider);
  const effectiveUsageProvider = useLastValidValue(usageProvider);
  const mainScrollRef = useRef<HTMLElement>(null);
  const providerScrollContainerRef = useRef<HTMLDivElement>(null);

  // 切换应用时回到列表顶部，避免沿用上一个应用的滚动位置（上游 4837fe2c）。
  useLayoutEffect(() => {
    if (currentView !== "providers") return;

    for (const container of [
      mainScrollRef.current,
      providerScrollContainerRef.current,
    ]) {
      if (container) {
        container.scrollTop = 0;
        container.scrollLeft = 0;
      }
    }
  }, [activeApp, currentView]);

  const addActionButtonClass = "theme-floating-action rounded-full w-8 h-8";

  const {
    isRunning: isProxyRunning,
    takeoverStatus,
    status: proxyStatus,
  } = useProxyStatus();
  const isCurrentAppTakeoverActive =
    activeApp !== "pi" &&
    activeApp !== "mcode" &&
    (takeoverStatus?.[activeApp] || false);
  const activeProviderId = useMemo(() => {
    const target = proxyStatus?.active_targets?.find(
      (t) => t.app_type === activeApp,
    );
    return target?.provider_id;
  }, [proxyStatus?.active_targets, activeApp]);

  const { data, isLoading } = useProvidersQuery(activeApp, {
    isProxyRunning,
  });
  const providers = useMemo(() => data?.providers ?? {}, [data]);
  const currentProviderId = data?.currentProviderId ?? "";
  const appMode = useAppMode(activeApp);
  const isOpenClawView =
    activeApp === "openclaw" && currentView === "providers";
  const { data: openclawHealthWarnings = [] } =
    useOpenClawHealth(isOpenClawView);
  const isHermesView = activeApp === "hermes" && currentView === "providers";
  const { data: hermesHealthWarnings = [] } = useHermesHealth(isHermesView);

  const {
    addProvider,
    updateProvider,
    switchProvider,
    deleteProvider,
    saveUsageScript,
    setAsDefaultModel,
  } = useProviderActions(
    activeApp,
    isProxyRunning,
    isProxyRunning && isCurrentAppTakeoverActive,
  );

  const disableOmoMutation = useDisableCurrentOmo();
  const handleDisableOmo = () => {
    disableOmoMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const disableOmoSlimMutation = useDisableCurrentOmoSlim();
  const handleDisableOmoSlim = () => {
    disableOmoSlimMutation.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("omo.disabled", { defaultValue: "OMO 已停用" }));
      },
      onError: (error: Error) => {
        toast.error(
          t("omo.disableFailed", {
            defaultValue: "停用 OMO 失败: {{error}}",
            error: extractErrorMessage(error),
          }),
        );
      },
    });
  };

  const currentViewRef = useRef(currentView);
  const isEnvBannerVisible = showEnvBanner && envConflicts.length > 0;
  const headerTopOffset =
    DRAG_BAR_HEIGHT + (isEnvBannerVisible ? envBannerHeight : 0);
  const [launchDashboardOpen, setLaunchDashboardOpen] = useState(false);
  const openHermesWebUI = useOpenHermesWebUI(() =>
    setLaunchDashboardOpen(true),
  );

  useEffect(() => {
    if (!isEnvBannerVisible && envBannerHeight !== 0) {
      setEnvBannerHeight(0);
    }
  }, [envBannerHeight, isEnvBannerVisible]);

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;

      if (document.body.style.overflow === "hidden") return;

      const view = currentViewRef.current;
      if (view === "providers") return;

      if (isTextEditableTarget(event.target)) return;

      event.preventDefault();
      setCurrentView("providers");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleOpenWebsite = async (url: string) => {
    try {
      await settingsApi.openExternal(url);
    } catch (error) {
      const detail =
        extractErrorMessage(error) ||
        t("notifications.openLinkFailed", {
          defaultValue: "链接打开失败",
        });
      toast.error(detail);
    }
  };

  const handleEditProvider = async ({
    provider,
    originalId,
    editorSave,
  }: {
    provider: Provider;
    originalId?: string;
    editorSave?: ProviderEditorSave;
  }) => {
    await updateProvider(provider, originalId, editorSave);
    setEditingProvider(null);
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    const { provider, action } = confirmAction;

    if (action === "remove") {
      // Remove from live config only (for additive mode apps like OpenCode/OpenClaw)
      // Does NOT delete from database - provider remains in the list
      await providersApi.removeFromLiveConfig(provider.id, activeApp);
      // Invalidate queries to refresh the isInConfig state
      if (activeApp === "opencode") {
        await queryClient.invalidateQueries({
          queryKey: ["opencodeLiveProviderIds"],
        });
      } else if (activeApp === "openclaw") {
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.liveProviderIds,
        });
        await queryClient.invalidateQueries({
          queryKey: openclawKeys.health,
        });
      } else if (activeApp === "hermes") {
        await queryClient.invalidateQueries({
          queryKey: hermesKeys.liveProviderIds,
        });
      } else if (activeApp === "pi") {
        await queryClient.invalidateQueries({
          queryKey: ["piLiveProviderIds"],
        });
        await queryClient.invalidateQueries({ queryKey: ["pi", "state"] });
      } else if (activeApp === "mcode") {
        // MiniMax Code 的“已添加”状态来自 meta.liveConfigManaged（上游 09c5d39d）。
        await queryClient.invalidateQueries({
          queryKey: ["providers", "mcode"],
        });
      }
      toast.success(
        t("notifications.removeFromConfigSuccess", {
          defaultValue: "已从配置移除",
        }),
        { closeButton: true },
      );
    } else {
      await deleteProvider(provider.id);
    }
    setConfirmAction(null);
  };

  const generateUniqueProviderCopyKey = (
    originalKey: string,
    existingKeys: string[],
  ): string => {
    const baseKey = `${originalKey}-copy`;

    if (!existingKeys.includes(baseKey)) {
      return baseKey;
    }

    let counter = 2;
    while (existingKeys.includes(`${baseKey}-${counter}`)) {
      counter++;
    }
    return `${baseKey}-${counter}`;
  };

  const handleDuplicateProvider = async (provider: Provider) => {
    if (
      activeApp === "opencode" &&
      provider.category !== "omo" &&
      provider.category !== "omo-slim"
    ) {
      const { npm, models } = provider.settingsConfig;
      if (
        typeof npm !== "string" ||
        !npm.trim() ||
        !models ||
        typeof models !== "object" ||
        Array.isArray(models) ||
        Object.keys(models).length === 0
      ) {
        toast.error(t("opencode.duplicateRequiresDefinition"));
        return;
      }
    }

    const duplicatedProvider: Omit<Provider, "id" | "createdAt"> & {
      providerKey?: string;
      addToLive?: boolean;
    } = {
      name: `${provider.name} copy`,
      settingsConfig: JSON.parse(JSON.stringify(provider.settingsConfig)), // 深拷贝
      websiteUrl: provider.websiteUrl,
      category: provider.category,
      meta: provider.meta
        ? JSON.parse(JSON.stringify(provider.meta))
        : undefined, // 深拷贝
      icon: provider.icon,
      iconColor: provider.iconColor,
    };

    if (
      activeApp === "opencode" ||
      activeApp === "openclaw" ||
      activeApp === "hermes" ||
      activeApp === "pi"
    ) {
      let liveProviderIds: string[] = [];
      try {
        liveProviderIds =
          activeApp === "opencode"
            ? await queryClient.ensureQueryData({
                queryKey: ["opencodeLiveProviderIds"],
                queryFn: () => providersApi.getOpenCodeLiveProviderIds(),
              })
            : activeApp === "openclaw"
              ? await queryClient.ensureQueryData({
                  queryKey: openclawKeys.liveProviderIds,
                  queryFn: () => providersApi.getOpenClawLiveProviderIds(),
                })
              : activeApp === "hermes"
                ? await queryClient.ensureQueryData({
                    queryKey: hermesKeys.liveProviderIds,
                    queryFn: () => providersApi.getHermesLiveProviderIds(),
                  })
                : await queryClient.ensureQueryData({
                    queryKey: ["piLiveProviderIds"],
                    queryFn: () => providersApi.getPiLiveProviderIds(),
                  });
      } catch (error) {
        console.error(
          "[App] Failed to load live provider IDs for duplication",
          error,
        );
        const errorMessage = extractErrorMessage(error);
        toast.error(
          t("notifications.duplicateLiveIdsLoadFailed", {
            defaultValue: "读取配置中的供应商标识失败，请先修复配置后再试",
          }) + (errorMessage ? `: ${errorMessage}` : ""),
        );
        return;
      }

      const existingKeys = Array.from(
        new Set([...Object.keys(providers), ...liveProviderIds]),
      );
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        existingKeys,
      );
      duplicatedProvider.addToLive = false;
    } else if (activeApp === "mcode") {
      // The list includes live custom nodes; the backend also guards native account keys.
      duplicatedProvider.providerKey = generateUniqueProviderCopyKey(
        provider.id,
        Object.keys(providers),
      );
    }

    await addProvider(duplicatedProvider);
  };

  const handleOpenTerminal = async (provider: Provider) => {
    try {
      await providersApi.openTerminal(provider.id, activeApp);
      toast.success(
        t("provider.terminalOpened", {
          defaultValue: "终端已打开",
        }),
      );
    } catch (error) {
      console.error("[App] Failed to open terminal", error);
      const errorMessage = extractErrorMessage(error);
      toast.error(
        t("provider.terminalOpenFailed", {
          defaultValue: "打开终端失败",
        }) + (errorMessage ? `: ${errorMessage}` : ""),
      );
    }
  };

  const renderContent = () => {
    const content = (() => {
      if (
        !isAdmin &&
        currentView === "providers" &&
        !["codex", "claude"].includes(activeApp)
      ) {
        return (
          <div className="mx-6 my-4 rounded-xl border p-6 text-sm text-muted-foreground">
            此应用的服务器配置由管理员维护。当前多用户聚合支持 Codex 和 Claude。
          </div>
        );
      }
      switch (currentView) {
        case "models":
        case "allocations":
        case "profile":
        case "admin":
          return <UnitPanel page={currentView} />;
        case "usage":
          return (
            <div className="px-3 md:px-6 py-4">
              <UsageDashboard />
            </div>
          );
        default:
          return (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden px-3 md:px-6">
              <div
                ref={providerScrollContainerRef}
                className="flex-1 overflow-y-auto overflow-x-hidden pb-12 px-1"
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeApp}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="space-y-4"
                  >
                    {supportsAppMode(activeApp) && (
                      <AppModePanel
                        key={activeApp}
                        app={activeApp}
                        providers={providers}
                        state={appMode}
                      />
                    )}
                    <ProviderList
                      modeView={appMode.data}
                      modePending={appMode.pending}
                      onAggregationMember={(id, enabled) => {
                        void appMode
                          .change({ kind: "member", id, enabled })
                          .catch(() => {});
                      }}
                      onAggregationDefault={(id) => {
                        void appMode
                          .change({ kind: "route", id })
                          .catch(() => {});
                      }}
                      providers={providers}
                      currentProviderId={currentProviderId}
                      appId={activeApp}
                      isLoading={isLoading}
                      isProxyRunning={isProxyRunning}
                      isProxyTakeover={
                        isProxyRunning && isCurrentAppTakeoverActive
                      }
                      activeProviderId={activeProviderId}
                      onSwitch={switchProvider}
                      onEdit={(provider) => {
                        if (
                          provider.unitResource &&
                          !provider.unitResource.owned
                        )
                          return;
                        setEditingProvider(provider);
                      }}
                      onDelete={(provider) =>
                        setConfirmAction({ provider, action: "delete" })
                      }
                      onRemoveFromConfig={
                        activeApp === "opencode" ||
                        activeApp === "openclaw" ||
                        activeApp === "hermes" ||
                        activeApp === "pi" ||
                        activeApp === "mcode"
                          ? (provider) =>
                              setConfirmAction({ provider, action: "remove" })
                          : undefined
                      }
                      onDisableOmo={
                        activeApp === "opencode" ? handleDisableOmo : undefined
                      }
                      onDisableOmoSlim={
                        activeApp === "opencode"
                          ? handleDisableOmoSlim
                          : undefined
                      }
                      onDuplicate={handleDuplicateProvider}
                      onConfigureUsage={setUsageProvider}
                      onOpenWebsite={handleOpenWebsite}
                      onOpenTerminal={
                        activeApp === "claude" ? handleOpenTerminal : undefined
                      }
                      onCreate={() => setIsAddOpen(true)}
                      onSetAsDefault={
                        activeApp === "openclaw"
                          ? setAsDefaultModel
                          : activeApp === "hermes"
                            ? switchProvider
                            : undefined
                      }
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          );
      }
    })();

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={currentView}
          className="flex flex-1 min-h-0 flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Suspense fallback={<div className="flex-1" />}>{content}</Suspense>
        </motion.div>
      </AnimatePresence>
    );
  };

  return (
    <div
      className="app-shell md:pl-14 flex flex-col h-screen overflow-hidden bg-background text-foreground selection:bg-primary/30 pb-4"
      style={{
        overflowX: "hidden",
        paddingTop: `calc(${headerTopOffset}px + var(--web-header-height, ${HEADER_HEIGHT}px))`,
      }}
    >
      <div
        className="fixed top-0 left-0 right-0 z-[60]"
        style={{ height: DRAG_BAR_HEIGHT }}
      />

      {isEnvBannerVisible && (
        <EnvWarningBanner
          conflicts={envConflicts}
          topOffset={DRAG_BAR_HEIGHT}
          onHeightChange={setEnvBannerHeight}
          onDismiss={() => {
            setShowEnvBanner(false);
            sessionStorage.setItem("env_banner_dismissed", "true");
          }}
          onDeleted={async () => {
            try {
              const allConflicts = await checkAllEnvConflicts();
              const flatConflicts = Object.values(allConflicts).flat();
              setEnvConflicts(flatConflicts);
              if (flatConflicts.length === 0) {
                setShowEnvBanner(false);
              }
            } catch (error) {
              console.error(
                "[App] Failed to re-check conflicts after deletion:",
                error,
              );
            }
          }}
        />
      )}

      <header
        className="fixed inset-x-0 md:left-14 z-50 transition-colors duration-300 bg-background/80 backdrop-blur-md"
        style={{
          top: headerTopOffset,
          height: `var(--web-header-height, ${HEADER_HEIGHT}px)`,
        }}
      >
        <div
          data-page-toolbar
          className="flex h-full items-center justify-between gap-2 px-6"
        >
          <div className="flex min-w-0 items-center gap-2">
            {currentView !== "providers" && (
              <Button
                variant="outline"
                size="icon"
                aria-label={t("common.back")}
                onClick={() => setCurrentView("providers")}
                className="mr-2 rounded-lg"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <h1 className="truncate text-lg font-semibold">
              {currentView === "providers"
                ? APP_DISPLAY_NAME[activeApp]
                : ({
                    models: "模型与接入",
                    allocations: "额度分配",
                    profile: "个人账号",
                    admin: "用户与额度",
                    usage: t("nav.usage"),
                  } as Record<string, string>)[currentView]}
            </h1>
            {currentView === "providers" && activeApp !== "pi" && (
              <RoutingActivationBrand
                active={isProxyRunning && isCurrentAppTakeoverActive}
                contextKey={activeApp}
                ready={
                  proxyStatus !== undefined && takeoverStatus !== undefined
                }
              />
            )}
          </div>

          <div className="flex flex-1 min-w-0 items-center justify-end gap-1.5">
            {currentView === "providers" &&
              activeApp !== "opencode" &&
              activeApp !== "openclaw" &&
              activeApp !== "hermes" &&
              activeApp !== "pi" &&
              activeApp !== "mcode" && (
                <div className="flex shrink-0 items-center gap-1.5">
                  {settingsData?.enableFailoverToggle &&
                    appMode.data?.mode === "routing" && (
                      <FailoverToggle activeApp={activeApp} />
                    )}
                </div>
              )}
            <div className="flex shrink-0 items-center">
              <div className="flex shrink-0 items-center gap-1.5 ml-auto">
                {currentView === "providers" && (
                  <Button
                    onClick={() => setIsAddOpen(true)}
                    size="icon"
                    className={`ml-2 inline-flex ${addActionButtonClass}`}
                  >
                    <Plus className="w-5 h-5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <WebSidebar
        currentView={currentView}
        onView={handleViewChange}
        activeApp={activeApp}
        onAppChange={setActiveApp}
        visibleApps={sidebarApps}
      />

      <main
        ref={mainScrollRef}
        className="flex-1 min-h-0 flex flex-col overflow-y-auto animate-fade-in"
      >
        {isOpenClawView && openclawHealthWarnings.length > 0 && (
          <OpenClawHealthBanner warnings={openclawHealthWarnings} />
        )}
        {isHermesView && hermesHealthWarnings.length > 0 && (
          <HermesHealthBanner
            warnings={hermesHealthWarnings}
            onOpenConfig={() => openHermesWebUI("/config")}
          />
        )}
        {renderContent()}
      </main>

      <Suspense fallback={null}>
        <AddProviderDialog
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          appId={activeApp}
          onSubmit={addProvider}
        />
      </Suspense>

      <Suspense fallback={null}>
        <EditProviderDialog
          open={Boolean(editingProvider)}
          provider={effectiveEditingProvider}
          onOpenChange={(open) => {
            if (!open) {
              setEditingProvider(null);
            }
          }}
          onSubmit={handleEditProvider}
          appId={activeApp}
          isProxyTakeover={isProxyRunning && isCurrentAppTakeoverActive}
        />
      </Suspense>

      {effectiveUsageProvider && (
        <Suspense fallback={null}>
          <UsageScriptModal
            key={effectiveUsageProvider.id}
            provider={effectiveUsageProvider}
            appId={activeApp}
            isOpen={Boolean(usageProvider)}
            onClose={() => setUsageProvider(null)}
            onSave={(script) => {
              if (usageProvider) {
                void saveUsageScript(usageProvider, script);
              }
            }}
          />
        </Suspense>
      )}

      <ConfirmDialog
        isOpen={Boolean(confirmAction)}
        title={
          confirmAction?.action === "remove"
            ? t("confirm.removeProvider")
            : t("confirm.deleteProvider")
        }
        message={
          confirmAction
            ? confirmAction.action === "remove"
              ? t("confirm.removeProviderMessage", {
                  name: confirmAction.provider.name,
                })
              : t("confirm.deleteProviderMessage", {
                  name: confirmAction.provider.name,
                })
            : ""
        }
        onConfirm={() => void handleConfirmAction()}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        isOpen={launchDashboardOpen}
        title={t("hermes.webui.launchConfirmTitle")}
        message={t("hermes.webui.launchConfirmMessage")}
        confirmText={t("hermes.webui.launchConfirmAction")}
        variant="info"
        onConfirm={() => {
          setLaunchDashboardOpen(false);
          void (async () => {
            try {
              await hermesApi.launchDashboard();
              toast.success(t("hermes.webui.launching"));
            } catch (error) {
              toast.error(t("hermes.webui.launchFailed"), {
                description: extractErrorMessage(error) || undefined,
              });
            }
          })();
        }}
        onCancel={() => setLaunchDashboardOpen(false)}
      />
      {!session && <FirstRunNoticeDialog />}
      <Suspense fallback={null}>
        <DeepLinkImportDialog />
      </Suspense>
    </div>
  );
}

export default App;
