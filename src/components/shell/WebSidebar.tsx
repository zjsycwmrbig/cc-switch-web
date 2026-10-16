import { useUnitSession } from "@/components/unit/session";
import { memo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart2,
  ChevronRight,
  Layers,
  LogOut,
  Menu,
  PanelLeftClose,
  Share2,
  UserRound,
  Users,
} from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  APP_DISPLAY_NAME,
  APP_ICON_NAME,
  visibleAppList,
} from "@/config/appMeta";
import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";
import { cn } from "@/lib/utils";

export type GlobalView =
  | "providers"
  | "models"
  | "usage"
  | "allocations"
  | "admin"
  | "profile";

const APPS_STORAGE_KEY = "cc-switch-web-sidebar-apps";

/** Expansion is local to the sidebar. The page keeps a fixed rail, so toggling never reflows the reader/editor. */
export const WebSidebar = memo(function WebSidebar({
  currentView,
  onView,
  activeApp,
  onAppChange,
  visibleApps,
}: {
  currentView: string;
  onView: (view: GlobalView) => void;
  activeApp: AppId;
  onAppChange: (app: AppId) => void;
  visibleApps?: VisibleApps;
}) {
  const { t } = useTranslation();
  const session = useUnitSession();
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("cc-switch-web-sidebar-expanded") === "true",
  );
  const [appsOpen, setAppsOpen] = useState(
    () => localStorage.getItem(APPS_STORAGE_KEY) !== "false",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const railHidden = !expanded && !mobileOpen;
  const toggle = () =>
    setExpanded((value) => {
      localStorage.setItem("cc-switch-web-sidebar-expanded", String(!value));
      return !value;
    });
  const toggleApps = (open: boolean) => {
    setAppsOpen(open);
    localStorage.setItem(APPS_STORAGE_KEY, String(open));
  };
  const selectView = (view: GlobalView) => {
    onView(view);
    setMobileOpen(false);
  };
  const selectApp = (app: AppId) => {
    onAppChange(app);
    selectView("providers");
  };
  /** 供应商这一行负责跳转并展开应用列表，收起由右侧箭头单独控制，避免一次点击把自己关掉。 */
  const selectProviders = () => {
    toggleApps(true);
    selectView("providers");
  };
  const item = (id: GlobalView, label: string, icon: ReactNode) => (
    <button
      key={id}
      type="button"
      aria-label={label}
      title={railHidden ? label : undefined}
      aria-current={currentView === id ? "page" : undefined}
      onClick={() => selectView(id)}
      className={cn(
        "flex h-9 w-full shrink-0 items-center gap-3 rounded-md px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        currentView === id && "bg-accent font-medium",
      )}
    >
      {icon}
      <span className={cn("whitespace-nowrap", railHidden && "sr-only")}>
        {label}
      </span>
    </button>
  );

  const apps = visibleAppList(visibleApps);
  const providerGroupOpen = appsOpen && !railHidden;
  const appActive = (app: AppId) =>
    currentView === "providers" && activeApp === app;

  return (
    <>
      <button
        type="button"
        aria-label={t("nav.menu", { defaultValue: "导航菜单" })}
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-5 left-3 z-[65] rounded-full border bg-card p-3 shadow-md md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      {mobileOpen && (
        <button
          aria-label={t("common.close")}
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-[64] bg-black/30 md:hidden"
        />
      )}
      <aside
        aria-label={t("nav.menu", { defaultValue: "导航菜单" })}
        data-web-sidebar
        className={cn(
          "fixed inset-y-0 left-0 z-[65] flex flex-col border-r border-border bg-card/95 p-2 backdrop-blur-md",
          expanded || mobileOpen ? "w-56 shadow-lg" : "w-14",
          !mobileOpen && "max-md:hidden",
        )}
      >
        <button
          type="button"
          onClick={mobileOpen ? () => setMobileOpen(false) : toggle}
          aria-label={t(expanded ? "nav.collapseSidebar" : "nav.expandSidebar", {
            defaultValue: expanded ? "收起侧栏" : "展开侧栏",
          })}
          className="mb-2 flex h-10 shrink-0 items-center gap-3 rounded-md px-2 hover:bg-accent"
        >
          <PanelLeftClose className="h-5 w-5 shrink-0" />
          <span className={cn("font-semibold", railHidden && "sr-only")}>
            CC Switch Web
          </span>
        </button>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overflow-x-hidden">
          {session &&
            item(
              "models",
              "模型与接入",
              <Layers className="h-4 w-4 shrink-0" />,
            )}
          {session &&
            item(
              "allocations",
              "额度分配",
              <Share2 className="h-4 w-4 shrink-0" />,
            )}
          {item("usage", t("nav.usage"), <BarChart2 className="h-4 w-4 shrink-0" />)}
          <div
            className={cn(
              "flex items-center rounded-md",
              currentView === "providers" && "bg-accent",
            )}
          >
            <button
              type="button"
              aria-label="供应商"
              title={railHidden ? "供应商" : undefined}
              aria-current={currentView === "providers" ? "page" : undefined}
              onClick={selectProviders}
              className={cn(
                "flex h-9 min-w-0 flex-1 items-center gap-3 rounded-md px-3 text-sm hover:bg-accent",
                currentView === "providers" && "font-medium",
              )}
            >
              <ProviderIcon
                icon={APP_ICON_NAME[activeApp]}
                name={APP_DISPLAY_NAME[activeApp]}
                size={16}
              />
              <span className={cn("truncate", railHidden && "sr-only")}>
                供应商
              </span>
            </button>
            {!railHidden && (
              <button
                type="button"
                aria-label={appsOpen ? "收起应用列表" : "展开应用列表"}
                aria-expanded={appsOpen}
                onClick={() => toggleApps(!appsOpen)}
                className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/60 hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform",
                    providerGroupOpen && "rotate-90",
                  )}
                />
              </button>
            )}
          </div>
          {providerGroupOpen && (
            <div className="ml-4 space-y-0.5 border-l border-border pl-2">
              {apps.map((app) => (
                <button
                  key={app}
                  type="button"
                  onClick={() => selectApp(app)}
                  aria-current={appActive(app) ? "page" : undefined}
                  className={cn(
                    "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                    appActive(app) &&
                      "bg-background font-medium text-foreground shadow-sm",
                  )}
                >
                  <ProviderIcon
                    className={appActive(app) ? "" : "grayscale opacity-60"}
                    icon={APP_ICON_NAME[app]}
                    name={APP_DISPLAY_NAME[app]}
                    size={16}
                  />
                  <span className="truncate">{APP_DISPLAY_NAME[app]}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {session && (
            <>
              {session.me.user.role === "admin" &&
                item("admin", "用户与额度", <Users className="h-4 w-4 shrink-0" />)}
              {item(
                "profile",
                session.me.user.username,
                <UserRound className="h-4 w-4 shrink-0" />,
              )}
              <button
                type="button"
                title="退出登录"
                onClick={() => void session.logout()}
                className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm hover:bg-accent"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className={cn(railHidden && "sr-only")}>退出登录</span>
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
});
