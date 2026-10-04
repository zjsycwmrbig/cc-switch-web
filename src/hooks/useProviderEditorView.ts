import { useEffect, useState } from "react";
import { providersApi, type ProviderEditorView } from "@/lib/api/providers";

/** A snapshot belongs to one open editor; never reuse it for another provider. */
export function useProviderEditorView(
  enabled: boolean,
  settings: Record<string, unknown>,
  identity: string,
  appId: "claude" | "codex" | "gemini" | "grokbuild" = "claude",
  category?: string,
) {
  const serialized = JSON.stringify(settings);
  const key = enabled
    ? `${appId}:${identity}:${category ?? ""}:${serialized}`
    : "";
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    view?: ProviderEditorView;
    error?: string;
  }>({ key: "" });
  useEffect(() => {
    let cancelled = false;
    setState({ key });
    if (enabled) {
      (appId === "claude"
        ? providersApi.getClaudeEditorView(JSON.parse(serialized))
        : appId === "codex"
          ? providersApi.getCodexEditorView(
              identity === "add"
                ? { auth: {}, config: "" }
                : JSON.parse(serialized),
              identity === "add" ? undefined : identity,
              identity === "add" ? "official" : category,
            )
          : appId === "grokbuild"
            ? providersApi.getGrokEditorView(
                identity === "add" ? { config: "" } : JSON.parse(serialized),
                identity === "add" ? undefined : identity,
                identity === "add" ? "official" : category,
              )
            : providersApi.getGeminiEditorView(
                JSON.parse(serialized),
                identity === "add" ? undefined : identity,
                category,
              )
      ).then(
        (view) => {
          if (!cancelled) setState({ key, view });
        },
        (error: unknown) => {
          if (!cancelled) setState({ key, error: String(error) });
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, key, serialized, attempt, appId, identity, category]);
  return {
    view: state.key === key ? state.view : undefined,
    error: state.key === key ? state.error : undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}
