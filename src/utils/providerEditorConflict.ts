import { extractErrorMessage } from "./errorUtils";
export interface ProviderEditorConflict {
  path: string;
  keys: string[];
}
export function parseProviderEditorConflict(
  error: unknown,
): ProviderEditorConflict | undefined {
  const message = extractErrorMessage(error);
  try {
    const data: unknown = JSON.parse(
      message.slice(message.indexOf("{"), message.lastIndexOf("}") + 1),
    );
    if (
      !data ||
      typeof data !== "object" ||
      !("code" in data) ||
      data.code !== "LIVE_EDIT_CONFLICT"
    )
      return;
    if (
      !("path" in data) ||
      typeof data.path !== "string" ||
      !("keys" in data) ||
      !Array.isArray(data.keys) ||
      !data.keys.every((key) => typeof key === "string")
    )
      return;
    return { path: data.path, keys: data.keys };
  } catch {
    return;
  }
}
