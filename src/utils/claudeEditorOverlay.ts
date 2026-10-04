function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Presets replace provider fields while retaining the live global baseline. */
export function overlayClaudeProviderFields(
  base: Record<string, unknown>,
  fields: Record<string, unknown>,
) {
  const result = { ...base, ...fields };
  if (isRecord(base.env) || isRecord(fields.env)) {
    result.env = {
      ...(isRecord(base.env) ? base.env : {}),
      ...(isRecord(fields.env) ? fields.env : {}),
    };
  }
  return result;
}
