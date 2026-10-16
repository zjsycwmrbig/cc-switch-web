import { useProviderEditorConflict } from "@/hooks/useProviderEditorConflict";
import { useProviderEditorView } from "@/hooks/useProviderEditorView";
import type { ProviderEditorSave } from "@/lib/api/providers";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import type { Provider, CustomEndpoint } from "@/types";
import type { AppId } from "@/lib/api";
import {
  ProviderForm,
  type ProviderFormValues,
} from "@/components/providers/forms/ProviderForm";
import { providerPresets } from "@/config/claudeProviderPresets";
import { codexProviderPresets } from "@/config/codexProviderPresets";
import { geminiProviderPresets } from "@/config/geminiProviderPresets";
import { grokBuildProviderPresets } from "@/config/grokBuildProviderPresets";
import { extractCodexBaseUrl } from "@/utils/providerConfigUtils";
import { extractGrokBuildBaseUrl } from "@/utils/grokBuildConfig";
import { GROKBUILD_OFFICIAL_PROVIDER_ID } from "@/utils/providerCapabilities";
import { extractErrorMessage } from "@/utils/errorUtils";
import { toast } from "sonner";
import type { OpenClawSuggestedDefaults } from "@/config/openclawProviderPresets";

interface AddProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appId: AppId;
  onSubmit: (
    provider: Omit<Provider, "id"> & {
      providerKey?: string;
      suggestedDefaults?: OpenClawSuggestedDefaults;
      addToLive?: boolean;
      ensureGrokBuildOfficialSeed?: boolean;
      ensureCodexOfficialSeed?: boolean;
      editorSave?: ProviderEditorSave;
    },
  ) => Promise<void> | void;
}

export function AddProviderDialog({
  open,
  onOpenChange,
  appId,
  onSubmit,
}: AddProviderDialogProps) {
  const { t } = useTranslation();
  const editorConflict = useProviderEditorConflict(open, appId);
  const providerEditor = useProviderEditorView(
    open &&
      (appId === "claude" ||
        appId === "codex" ||
        appId === "gemini" ||
        appId === "grokbuild"),
    {},
    "add",
    appId === "codex"
      ? "codex"
      : appId === "grokbuild"
        ? "grokbuild"
        : appId === "gemini"
          ? "gemini"
          : "claude",
  );
  const editorReady =
    (appId !== "claude" &&
      appId !== "codex" &&
      appId !== "gemini" &&
      appId !== "grokbuild") ||
    !!providerEditor.view;
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: ProviderFormValues) => {
      let parsedConfig: Record<string, unknown>;
      try {
        parsedConfig = JSON.parse(values.settingsConfig) as Record<
          string,
          unknown
        >;
      } catch {
        toast.error(
          t("jsonEditor.invalidJson", { defaultValue: "配置不是合法 JSON" }),
        );
        return;
      }

      // 构造基础提交数据
      const providerData: Omit<Provider, "id"> & {
        providerKey?: string;
        suggestedDefaults?: OpenClawSuggestedDefaults;
        addToLive?: boolean;
        ensureGrokBuildOfficialSeed?: boolean;
        ensureCodexOfficialSeed?: boolean;
        editorSave?: ProviderEditorSave;
      } = {
        name: values.name.trim(),
        notes: values.notes?.trim() || undefined,
        websiteUrl: values.websiteUrl?.trim() || undefined,
        settingsConfig: parsedConfig,
        icon: values.icon?.trim() || undefined,
        iconColor: values.iconColor?.trim() || undefined,
        ...(values.presetCategory ? { category: values.presetCategory } : {}),
        ...(values.meta ? { meta: values.meta } : {}),
      };

      if (
        appId === "grokbuild" &&
        values.presetCategory === "official" &&
        values.presetId === GROKBUILD_OFFICIAL_PROVIDER_ID
      ) {
        providerData.ensureGrokBuildOfficialSeed = true;
      }

      if (
        appId === "codex" &&
        values.presetCategory === "official" &&
        values.presetId === "codex-0"
      ) {
        providerData.ensureCodexOfficialSeed = true;
      }

      // 累加模式应用：传递 providerKey 作为 Provider ID
      if (
        (appId === "opencode" ||
          appId === "openclaw" ||
          appId === "hermes" ||
          appId === "pi" ||
          appId === "mcode") &&
        values.providerKey
      ) {
        providerData.providerKey = values.providerKey;
      }

      const hasCustomEndpoints =
        providerData.meta?.custom_endpoints &&
        Object.keys(providerData.meta.custom_endpoints).length > 0;

      if (!hasCustomEndpoints && values.presetCategory !== "omo") {
        const urlSet = new Set<string>();

        const addUrl = (rawUrl?: string) => {
          const url = (rawUrl || "").trim().replace(/\/+$/, "");
          if (url && url.startsWith("http")) {
            urlSet.add(url);
          }
        };

        if (values.presetId) {
          if (appId === "claude") {
            const presets = providerPresets;
            const presetIndex = parseInt(
              values.presetId.replace("claude-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (preset?.endpointCandidates) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "codex") {
            const presets = codexProviderPresets;
            const presetIndex = parseInt(values.presetId.replace("codex-", ""));
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "gemini") {
            const presets = geminiProviderPresets;
            const presetIndex = parseInt(
              values.presetId.replace("gemini-", ""),
            );
            if (
              !isNaN(presetIndex) &&
              presetIndex >= 0 &&
              presetIndex < presets.length
            ) {
              const preset = presets[presetIndex];
              if (Array.isArray(preset.endpointCandidates)) {
                preset.endpointCandidates.forEach(addUrl);
              }
            }
          } else if (appId === "grokbuild") {
            const presetIndex = parseInt(
              values.presetId.replace("grokbuild-", ""),
            );
            const preset = grokBuildProviderPresets[presetIndex];
            preset?.endpointCandidates?.forEach(addUrl);
          }
        }

        if (appId === "claude") {
          const env = parsedConfig.env as Record<string, any> | undefined;
          if (env?.ANTHROPIC_BASE_URL) {
            addUrl(env.ANTHROPIC_BASE_URL);
          }
        } else if (appId === "codex") {
          const config = parsedConfig.config as string | undefined;
          if (config) {
            const extractedBaseUrl = extractCodexBaseUrl(config);
            if (extractedBaseUrl) {
              addUrl(extractedBaseUrl);
            }
          }
        } else if (appId === "gemini") {
          const env = parsedConfig.env as Record<string, any> | undefined;
          if (env?.GOOGLE_GEMINI_BASE_URL) {
            addUrl(env.GOOGLE_GEMINI_BASE_URL);
          }
        } else if (appId === "grokbuild") {
          const config = parsedConfig.config as string | undefined;
          if (config) {
            addUrl(extractGrokBuildBaseUrl(config));
          }
        } else if (appId === "opencode") {
          const options = parsedConfig.options as
            | Record<string, any>
            | undefined;
          if (options?.baseURL) {
            addUrl(options.baseURL);
          }
        } else if (appId === "openclaw") {
          // OpenClaw uses baseUrl directly
          if (parsedConfig.baseUrl) {
            addUrl(parsedConfig.baseUrl as string);
          }
        } else if (appId === "hermes") {
          if (parsedConfig.base_url) {
            addUrl(parsedConfig.base_url as string);
          }
        }

        const urls = Array.from(urlSet);
        if (urls.length > 0) {
          const now = Date.now();
          const customEndpoints: Record<string, CustomEndpoint> = {};
          urls.forEach((url) => {
            customEndpoints[url] = {
              url,
              addedAt: now,
              lastUsed: undefined,
            };
          });

          providerData.meta = {
            ...(providerData.meta ?? {}),
            custom_endpoints: customEndpoints,
          };
        }
      }

      // OpenClaw: pass suggestedDefaults for model registration
      if (appId === "openclaw" && values.suggestedDefaults) {
        providerData.suggestedDefaults = values.suggestedDefaults;
      }

      if (
        appId === "claude" ||
        appId === "codex" ||
        appId === "gemini" ||
        appId === "grokbuild"
      ) {
        if (!providerEditor.view) return;
        providerData.editorSave = {
          base: providerEditor.view.settings,
          onConflict: "refuse",
        };
      }
      try {
        const saved = await editorConflict.run((policy) =>
          onSubmit({
            ...providerData,
            ...(providerData.editorSave
              ? {
                  editorSave: {
                    ...providerData.editorSave,
                    onConflict: policy,
                  },
                }
              : {}),
          }),
        );
        if (saved) onOpenChange(false);
      } catch (error) {
        // 服务端错误已由保存流程提示；这里兜底提示纯前端异常，避免点击后毫无反馈。
        console.error("[AddProviderDialog] 保存供应商失败", error);
        if (error instanceof TypeError || error instanceof SyntaxError) {
          toast.error(
            extractErrorMessage(error) || "保存供应商失败，请重试",
          );
        }
      }
    },
    [appId, onSubmit, onOpenChange, providerEditor.view, editorConflict.run],
  );

  const footer = (
    <>
      <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
        {t("provider.addFooterHint")}
      </span>
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        className="border-border/20 hover:bg-accent hover:text-accent-foreground"
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        form="provider-form"
        disabled={isFormSubmitting || !editorReady}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        <Plus className="h-4 w-4 mr-2" />
        {t("common.add")}
      </Button>
    </>
  );

  return (
    <>
      {editorConflict.dialog}
      <FullScreenPanel
        isOpen={open}
        title={t("provider.addNewProvider")}
        onClose={() => onOpenChange(false)}
        footer={footer}
        contentClassName="pt-3"
      >
        {!editorReady ? (
          <div role="status">
            {providerEditor.error
              ? t("claudeConfig.editorLoadFailed")
              : t("common.loading")}
            {providerEditor.error && (
              <Button onClick={providerEditor.retry}>
                {t("common.retry")}
              </Button>
            )}
          </div>
        ) : (
          <ProviderForm
            providerLiveBase={providerEditor.view?.settings}
            appId={appId}
            submitLabel={t("common.add")}
            onSubmit={handleSubmit}
            onCancel={() => onOpenChange(false)}
            onSubmittingChange={setIsFormSubmitting}
            showButtons={false}
          />
        )}
      </FullScreenPanel>
    </>
  );
}
