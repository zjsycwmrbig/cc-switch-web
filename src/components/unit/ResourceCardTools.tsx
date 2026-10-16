import { useUnitSession } from "./session";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unit, type Resource } from "./client";
export function ResourceCardTools({
  resource,
}: {
  resource: Resource;
}) {
  const [busy, setBusy] = useState(false);
  const query = useQueryClient();
  const session = useUnitSession();
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
  if (!resource.owned)
    return session?.me.user.role === "admin" ? (
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
    ) : null;
  return (
    <div className="mt-2 flex justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void refresh()}
      >
        <RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        获取模型
      </Button>
    </div>
  );
}
