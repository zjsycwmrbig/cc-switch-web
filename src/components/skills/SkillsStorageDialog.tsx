import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/lib/api";
import type { SkillSyncMethod } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SkillStorageLocationSettings } from "@/components/settings/SkillStorageLocationSettings";
import { SkillSyncMethodSettings } from "@/components/settings/SkillSyncMethodSettings";
import { toast } from "sonner";
export function SkillsStorageDialog({
  installedCount,
}: {
  installedCount: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: settingsApi.get,
    enabled: open,
  });
  const save = useMutation({
    mutationFn: async (method: SkillSyncMethod) => {
      const latest = await settingsApi.get();
      await settingsApi.save({ ...latest, skillSyncMethod: method });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
    onError: (e) => toast.error(String(e)),
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t("settings.skillStorage.title")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg p-6">
          <DialogHeader>
            <DialogTitle>{t("settings.skillStorage.title")}</DialogTitle>
          </DialogHeader>
          {settings.data ? (
            <div className="space-y-5">
              <SkillStorageLocationSettings
                value={settings.data.skillStorageLocation ?? "cc_switch"}
                installedCount={installedCount}
                onMigrated={() =>
                  void client.invalidateQueries({ queryKey: ["settings"] })
                }
              />
              <fieldset disabled={save.isPending}>
                <SkillSyncMethodSettings
                  value={settings.data.skillSyncMethod ?? "auto"}
                  onChange={(method) => save.mutate(method)}
                />
              </fieldset>
              <p className="text-sm text-muted-foreground">
                {t("skills.resyncAfterSettings")}
              </p>
            </div>
          ) : (
            <p>{settings.isError ? t("common.error") : t("common.loading")}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
