import { parse, stringify } from "smol-toml";

// The backend applies changes against the original live bytes, preserving comments.
const keyFields = [
  "model_provider",
  "openai_base_url",
  "model",
  "review_model",
  "model_reasoning_effort",
  "plan_mode_reasoning_effort",
  "disable_response_storage",
  "model_catalog_json",
  "experimental_bearer_token",
  "base_url",
  "wire_api",
];
const nestedFields = {
  agents: ["default_subagent_model", "default_subagent_reasoning_effort"],
  memories: ["extract_model", "consolidation_model"],
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** The new-provider baseline contains globals only; preset key fields replace its route. */
export function overlayCodexProviderConfig(
  base: unknown,
  config: string,
): string {
  if (typeof base !== "string" || !base.trim()) return config;
  const global = parse(base);
  const preset = parse(config);
  const routes = { ...object(global.model_providers) };
  delete routes.custom;
  delete routes["cc-switch-official"];
  for (const key of keyFields) delete global[key];
  const combined: Record<string, unknown> = {
    ...global,
    ...preset,
    model_providers: { ...routes, ...object(preset.model_providers) },
  };
  for (const [table, fields] of Object.entries(nestedFields)) {
    const value = { ...object(global[table]) };
    for (const key of fields) delete value[key];
    const merged = { ...value, ...object(preset[table]) };
    if (Object.keys(merged).length) combined[table] = merged;
  }
  return stringify(combined);
}
