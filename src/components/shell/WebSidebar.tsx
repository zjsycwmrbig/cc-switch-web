import { useUnitSession } from "@/components/unit/session";
import { memo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart2,
  KeyRound,
  Menu,
  Network,
  PanelLeftClose,
  Share2,
  UserRound,
  Users,
  Layers,
  LogOut,
  ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type GlobalView =
  | "models"
  | "allocations"
  | "profile"
  | "admin"
  | "ledger"
  | "providers"
  | "universal"
  | "usage"
  | "accounts";

/** Expansion is local to the sidebar. The page keeps a fixed rail, so toggling never reflows the reader/editor. */
export const WebSidebar = memo(function WebSidebar({
  currentView,
  onView,
}: {
  currentView: string;
  onView: (view: GlobalView) => void;
}) {
  const { t } = useTranslation();
  const session = useUnitSession();
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("cc-switch-web-sidebar-expanded") === "true",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () =>
    setExpanded((value) => {
      localStorage.setItem("cc-switch-web-sidebar-expanded", String(!value));
      return !value;
    });
  const selectView = (view: GlobalView) => {
    onView(view);
    setMobileOpen(false);
  };
  const item = (id: GlobalView, label: string, icon: ReactNode) => (
    <button
      key={id}
      type="button"
      aria-label={label}
      title={!expanded ? label : undefined}
      aria-current={currentView === id ? "page" : undefined}
      onClick={() => selectView(id)}
      className={cn(
        "flex h-9 w-full shrink-0 items-center gap-3 rounded-md px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        currentView === id && "bg-accent font-medium",
      )}
    >
      {icon}
      <span
        className={cn(
          "whitespace-nowrap",
          !expanded && !mobileOpen && "sr-only",
        )}
      >
        {label}
      </span>
    </button>
  );
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
          aria-label={t(
            expanded ? "nav.collapseSidebar" : "nav.expandSidebar",
            { defaultValue: expanded ? "收起侧栏" : "展开侧栏" },
          )}
          className="mb-2 flex h-10 shrink-0 items-center gap-3 rounded-md px-2 hover:bg-accent"
        >
          <PanelLeftClose className="h-5 w-5 shrink-0" />
          <span
            className={cn(
              "font-semibold",
              !expanded && !mobileOpen && "sr-only",
            )}
          >
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
          {item(
            "universal",
            t("universalProvider.title"),
            <Network className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "usage",
            t("nav.usage"),
            <BarChart2 className="h-4 w-4 shrink-0" />,
          )}
          {item(
            "accounts",
            t("settings.authCenter.title"),
            <KeyRound className="h-4 w-4 shrink-0" />,
          )}
        </nav>
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          {session && (
            <>
              {item(
                "allocations",
                "额度分配",
                <Share2 className="h-4 w-4 shrink-0" />,
              )}
              {item(
                "ledger",
                "配额与账本",
                <ClipboardList className="h-4 w-4 shrink-0" />,
              )}
              {session.me.user.role === "admin" &&
                item(
                  "admin",
                  "用户与额度",
                  <Users className="h-4 w-4 shrink-0" />,
                )}
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
                <span className={cn(!expanded && !mobileOpen && "sr-only")}>
                  退出登录
                </span>
              </button>
            </>
          )}
        </div>
      </aside>
    </>
  );
});
