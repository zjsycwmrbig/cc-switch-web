import { unit } from "@/components/unit/client";
import { useUnitSession } from "@/components/unit/session";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  downloadWebAggregationModels,
  getWebAccessKey,
  getWebApiBase,
} from "@/lib/runtime/client/web";

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export function AggregationSyncPanel({
  onPersonalModels,
  onDevices,
}: { onPersonalModels?: () => void; onDevices?: () => void } = {}) {
  const session = useUnitSession();
  const [personalCommand, setPersonalCommand] = useState("");
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const origin = (getWebApiBase() || window.location.origin).replace(/\/$/, "");
  const key = getWebAccessKey();
  const auth = key ? `-H ${quote(`Authorization: Bearer ${key}`)} ` : "";
  const legacyCommand = `curl -fsSL ${auth}${quote(`${origin}/api/model-catalog/codex/aggregation/install.sh`)} | CC_SWITCH_RESTART_APP_SERVER=1 bash`;
  const command = session ? personalCommand : legacyCommand;
  const copy = async () => {
    let toCopy = command;
    if (session && !toCopy) {
      setBusy(true);
      try {
        const value = await unit<{ command: string }>("/keys", "POST", {
          name: `网页模型同步 ${new Date().toLocaleString()}`,
        });
        toCopy = value.command;
        setPersonalCommand(toCopy);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        return;
      } finally {
        setBusy(false);
      }
    }
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
  return (
    <section className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t("aggregationSync.title")}</h3>
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
      <p className="text-sm text-muted-foreground">
        {session
          ? "同步你有权使用且已选择的聚合模型。命令使用你的设备密钥，调用记录和额度归属你的账号。"
          : t("aggregationSync.description")}
      </p>
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
      <p className="text-xs text-muted-foreground">
        {t("aggregationSync.reload")}
      </p>
    </section>
  );
}
