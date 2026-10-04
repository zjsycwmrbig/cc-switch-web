import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { promptsApi, type AppId, type Prompt } from "@/lib/api";
import { APP_DISPLAY_NAME } from "@/components/shell/AppGlyph";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const TARGETS: AppId[] = [
  "claude",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
  "mcode",
];

/** Each destination receives an independent, disabled record. Retrying only repeats failures. */
export function PromptCopyDialog({
  prompt,
  source,
  onClose,
}: {
  prompt: Prompt;
  source: AppId;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [picks, setPicks] = useState<AppId[]>([]);
  const [completed, setCompleted] = useState<AppId[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const copy = async () => {
    if (pending || !picks.length) return;
    setPending(true);
    setError("");
    const results = await Promise.allSettled(
      picks.map(async (app) => {
        const id =
          globalThis.crypto?.randomUUID?.() ??
          `prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await promptsApi.upsertPrompt(app, id, {
          ...prompt,
          id,
          enabled: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }),
    );
    const failed = picks.filter(
      (_, index) => results[index].status === "rejected",
    );
    setCompleted((old) => [
      ...old,
      ...picks.filter((app) => !failed.includes(app)),
    ]);
    setPicks(failed);
    setPending(false);
    if (failed.length) {
      setError(
        results
          .flatMap((result, index) =>
            result.status === "rejected"
              ? [`${APP_DISPLAY_NAME[picks[index]]}: ${String(result.reason)}`]
              : [],
          )
          .join("\n"),
      );
    } else {
      toast.success(t("prompts.webCopy.success"));
      onClose();
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-w-md p-6">
        <DialogTitle>
          {t("prompts.webCopy.title", { name: prompt.name })}
        </DialogTitle>
        <DialogDescription>
          {t("prompts.webCopy.description")}
        </DialogDescription>
        <div className="space-y-2">
          {TARGETS.filter((app) => app !== source).map((app) => (
            <label key={app} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={picks.includes(app) || completed.includes(app)}
                disabled={pending || completed.includes(app)}
                onChange={(event) =>
                  setPicks((old) =>
                    event.target.checked
                      ? [...old, app]
                      : old.filter((value) => value !== app),
                  )
                }
              />
              {APP_DISPLAY_NAME[app]}
            </label>
          ))}
        </div>
        {error && (
          <p
            role="alert"
            className="whitespace-pre-wrap break-words text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={pending || !picks.length}
            onClick={() => void copy()}
          >
            {t("common.copy")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
