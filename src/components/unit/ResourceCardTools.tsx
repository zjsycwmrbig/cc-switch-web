import { useUnitSession } from "./session";
import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import { unit, type Resource } from "./client";

const AuthCenterPanel = lazy(() =>
  import("@/components/settings/AuthCenterPanel").then((m) => ({
    default: m.AuthCenterPanel,
  })),
);

export function ResourceCardTools({
  resource,
}: {
  resource: Resource;
}) {
  const [busy, setBusy] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const query = useQueryClient();
  const session = useUnitSession();
  const isAdmin = session?.me.user.role === "admin";
  const refresh = async () => {
    setBusy(true);
    try {
      const models = await unit<unknown[]>(
        `/resources/${resource.id}/models/refresh`,
        "POST",
      );
      await query.invalidateQueries({
        queryKey: ["providers", resource.appType],
      });
      toast.success(`已获取 ${models.length} 个模型`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!resource.owned && !isAdmin) return null;
  return (
    <div className="mt-2 flex items-center justify-end gap-1">
      {!resource.owned && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await unit(`/admin/resources/${resource.id}`, "PUT", {
                disabled: !resource.disabled,
              });
              await query.invalidateQueries({ queryKey: ["providers"] });
              await query.invalidateQueries({ queryKey: ["appMode"] });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {resource.disabled ? "解除平台停用" : "平台停用"}
        </Button>
      )}
      {resource.official && isAdmin && (
        <Button variant="ghost" size="sm" onClick={() => setAccountsOpen(true)}>
          <KeyRound className="mr-1 h-4 w-4" />
          官方账号
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void refresh()}
      >
        <RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        获取模型
      </Button>
      {resource.official && (
        <FullScreenPanel
          isOpen={accountsOpen}
          title="官方账号"
          onClose={() => setAccountsOpen(false)}
          contentClassName="pt-3"
        >
          <Suspense fallback={<div className="p-6 text-sm">加载中…</div>}>
            <AuthCenterPanel />
          </Suspense>
        </FullScreenPanel>
      )}
    </div>
  );
}
