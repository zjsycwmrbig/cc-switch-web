import { Moon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleRow } from "@/components/ui/toggle-row";
import {
  isWindowIdleSleepEnabled,
  setWindowIdleSleepEnabled,
} from "@/lib/windowActivity";
import { useState } from "react";

export function IdleSleepSettings() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(isWindowIdleSleepEnabled);

  const handleChange = (next: boolean) => {
    setEnabled(next);
    setWindowIdleSleepEnabled(next);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <Moon className="h-4 w-4 text-primary" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">
            {t("settings.idleSleep.title", { defaultValue: "前端休眠" })}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("settings.idleSleep.hint", {
              defaultValue: "控制当前浏览器页面在空闲时是否暂停后端交互",
            })}
          </p>
        </div>
      </div>

      <ToggleRow
        icon={<Moon className="h-4 w-4 text-violet-500" />}
        title={t("settings.idleSleep.enabled", {
          defaultValue: "启用 1 分钟空闲休眠",
        })}
        description={t("settings.idleSleep.enabledDescription", {
          defaultValue:
            "1 分钟内无鼠标、键盘或触摸操作时进入休眠；休眠期间不发起后端请求，任意操作即可唤醒。",
        })}
        checked={enabled}
        onCheckedChange={handleChange}
      />
    </section>
  );
}
