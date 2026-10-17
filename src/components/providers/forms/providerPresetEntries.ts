import type { AppId } from "@/lib/api";
import {
  providerPresets,
  type ProviderPreset,
} from "@/config/claudeProviderPresets";
import {
  codexProviderPresets,
  type CodexProviderPreset,
} from "@/config/codexProviderPresets";
import {
  geminiProviderPresets,
  type GeminiProviderPreset,
} from "@/config/geminiProviderPresets";
import {
  opencodeProviderPresets,
  type OpenCodeProviderPreset,
} from "@/config/opencodeProviderPresets";
import {
  openclawProviderPresets,
  type OpenClawProviderPreset,
} from "@/config/openclawProviderPresets";
import {
  hermesProviderPresets,
  type HermesProviderPreset,
} from "@/config/hermesProviderPresets";

export type PresetEntry = {
  id: string;
  preset:
    | ProviderPreset
    | CodexProviderPreset
    | GeminiProviderPreset
    | OpenCodeProviderPreset
    | OpenClawProviderPreset
    | HermesProviderPreset;
};

/**
 * 当前应用可用的内置预设供应商清单。
 * 新增/编辑表单与供应商工作台的「供应商库」共用同一份数据。
 */
export function buildPresetEntries(appId: AppId): PresetEntry[] {
  if (appId === "codex") {
    return codexProviderPresets.map((preset, index) => ({
      id: `codex-${index}`,
      preset,
    }));
  }
  if (appId === "gemini") {
    return geminiProviderPresets.map((preset, index) => ({
      id: `gemini-${index}`,
      preset,
    }));
  }
  if (appId === "opencode") {
    return opencodeProviderPresets.map((preset, index) => ({
      id: `opencode-${index}`,
      preset,
    }));
  }
  if (appId === "openclaw") {
    return openclawProviderPresets.map((preset, index) => ({
      id: `openclaw-${index}`,
      preset,
    }));
  }
  if (appId === "hermes") {
    return hermesProviderPresets.map((preset, index) => ({
      id: `hermes-${index}`,
      preset,
    }));
  }
  return providerPresets
    .filter((preset) => !preset.hidden)
    .map((preset, index) => ({ id: `claude-${index}`, preset }));
}
