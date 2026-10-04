import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ProviderEditorSave } from "@/lib/api/providers";
import {
  parseProviderEditorConflict,
  type ProviderEditorConflict,
} from "@/utils/providerEditorConflict";

type Resolution = "keepMine" | "keepTheirs" | undefined;
/** A rejected save keeps the original snapshot and draft until the user chooses. */
export function useProviderEditorConflict(open: boolean, identity = "") {
  const { t } = useTranslation();
  const [conflict, setConflict] = useState<ProviderEditorConflict>();
  const lifecycle = useRef({ open, identity, generation: 0 });
  if (
    lifecycle.current.open !== open ||
    lifecycle.current.identity !== identity
  ) {
    lifecycle.current = {
      open,
      identity,
      generation: lifecycle.current.generation + 1,
    };
  }
  const resolve = useRef<(choice: Resolution) => void>();
  const choose = useCallback((choice: Resolution) => {
    const pending = resolve.current;
    resolve.current = undefined;
    setConflict(undefined);
    pending?.(choice);
  }, []);
  useEffect(() => {
    lifecycle.current.open = open;
    choose(undefined);
    return () => {
      lifecycle.current.open = false;
      lifecycle.current.generation += 1;
      resolve.current?.(undefined);
      resolve.current = undefined;
    };
  }, [open, identity, choose]);
  const run = useCallback(
    async (
      save: (policy: ProviderEditorSave["onConflict"]) => unknown,
    ): Promise<boolean> => {
      const generation = lifecycle.current.generation;
      try {
        await save("refuse");
        return (
          lifecycle.current.open && lifecycle.current.generation === generation
        );
      } catch (error) {
        const details = parseProviderEditorConflict(error);
        if (!details) throw error;
        if (
          !lifecycle.current.open ||
          lifecycle.current.generation !== generation
        )
          return false;
        const choice = await new Promise<Resolution>((done) => {
          resolve.current = done;
          setConflict(details);
        });
        if (!choice) return false;
        await save(choice);
        return (
          lifecycle.current.open && lifecycle.current.generation === generation
        );
      }
    },
    [],
  );
  const dialog = (
    <Dialog
      open={!!conflict}
      onOpenChange={(value) => {
        if (!value) choose(undefined);
      }}
    >
      <DialogContent zIndex="top">
        <DialogHeader>
          <DialogTitle>{t("providerEditor.conflictTitle")}</DialogTitle>
          <DialogDescription>
            {t("providerEditor.conflictDescription")}
          </DialogDescription>
        </DialogHeader>
        <p className="break-all text-sm text-muted-foreground">
          {conflict?.path}
        </p>
        <ul className="max-h-48 overflow-auto text-sm">
          {conflict?.keys.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => choose(undefined)}>
            {t("providerEditor.keepEditing")}
          </Button>
          <Button variant="outline" onClick={() => choose("keepTheirs")}>
            {t("providerEditor.keepTheirs")}
          </Button>
          <Button onClick={() => choose("keepMine")}>
            {t("providerEditor.keepMine")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { run, dialog };
}
