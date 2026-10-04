import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
export function ResyncButton({
  run,
  queryKey,
  disabled = false,
}: {
  run: () => Promise<
    {
      app: string;
      ok: boolean;
      error?: string;
      failedSkills?: { directory: string; error: string }[];
    }[]
  >;
  queryKey: string[];
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string[]>([]);
  return (
    <div className="my-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setReport([]);
          try {
            const outcomes = await run();
            setReport(
              outcomes.map(
                (o) =>
                  `${o.app}: ${o.ok ? t("common.success") : [o.error, ...(o.failedSkills ?? []).map((f) => `${f.directory}: ${f.error}`)].filter(Boolean).join("; ")}`,
              ),
            );
          } catch (e) {
            setReport([String(e)]);
          } finally {
            await client.invalidateQueries({ queryKey });
            setBusy(false);
          }
        }}
      >
        {busy ? t("common.loading") : t("common.resync")}
      </Button>
      {report.length > 0 && (
        <details open className="mt-2 text-sm">
          <summary>{t("common.resyncResult")}</summary>
          <ul>
            {report.map((line, i) => (
              <li key={i} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
