/**
 * 新增/编辑供应商时的预设排序权重：官方与最常用的服务排在最前面，
 * 其余预设仍按名称排序，避免常用项散落在几十个模板中间。
 */
const FEATURED_PRESETS = [
  "OpenAI Official",
  "Claude Official",
  "DeepSeek",
  "Kimi",
  "Kimi Global",
  "Kimi For Coding",
  "Kimi For Coding Global",
  "ClaudeCN",
  "Gemini Official",
];

/** 自定义配置始终排在最前；未在常用列表中的预设排在它们之后。 */
export function presetSortWeight(name: string): number {
  const normalized = name.trim().toLowerCase();
  if (normalized.includes("custom") || normalized.includes("自定义")) {
    return -1;
  }
  const index = FEATURED_PRESETS.findIndex(
    (item) => item.toLowerCase() === normalized,
  );
  return index === -1 ? FEATURED_PRESETS.length : index;
}
