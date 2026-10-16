import type { AppId } from "@/lib/api";
import type { VisibleApps } from "@/types";

/** 应用展示顺序：侧栏二级菜单、顶栏切换器共用。 */
export const ALL_APPS: AppId[] = [
  "claude",
  "claude-desktop",
  "codex",
  "gemini",
  "grokbuild",
  "opencode",
  "openclaw",
  "hermes",
  "pi",
  "mcode",
];

export const APP_ICON_NAME: Record<AppId, string> = {
  claude: "claude",
  "claude-desktop": "claude",
  codex: "openai",
  gemini: "gemini",
  grokbuild: "grok",
  opencode: "opencode",
  openclaw: "openclaw",
  hermes: "hermes",
  pi: "pi",
  mcode: "minimax",
};

export const APP_DISPLAY_NAME: Record<AppId, string> = {
  claude: "Claude",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  gemini: "Gemini",
  grokbuild: "Grok Build",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  hermes: "Hermes",
  pi: "Pi",
  mcode: "MiniMax Code",
};

/** 按可见性设置过滤应用；未配置时全部可见。 */
export function visibleAppList(visibleApps?: VisibleApps): AppId[] {
  if (!visibleApps) return ALL_APPS;
  return ALL_APPS.filter((app) => visibleApps[app]);
}
