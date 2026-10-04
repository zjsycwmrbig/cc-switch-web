import { useTranslation } from "react-i18next";
import type { SkillRepoFailure } from "@/lib/api/skills";
export function SkillRepoFailures({
  failures = [],
}: {
  failures?: SkillRepoFailure[];
}) {
  const { t } = useTranslation();
  if (!failures.length) return null;
  return (
    <details className="my-3 rounded-lg border border-border p-3 text-sm">
      <summary>{t("skills.repoFailures", { count: failures.length })}</summary>
      <ul className="mt-2 space-y-2">
        {failures.map((f) => (
          <li key={`${f.owner}/${f.name}/${f.branch}`} className="break-words">
            <strong>
              {f.owner}/{f.name} ({f.branch})
            </strong>
            <p>{f.error}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
