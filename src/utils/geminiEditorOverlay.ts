function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function merge(
  base: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(fields)) {
    result[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? merge(record(base[key]), record(value))
        : value;
  }
  return result;
}

export function overlayGeminiProviderFields(
  base: Record<string, unknown>,
  fieldsValue: unknown,
) {
  const fields = record(fieldsValue);
  return {
    ...base,
    ...fields,
    env: { ...record(base.env), ...record(fields.env) },
    config: merge(record(base.config), record(fields.config)),
  };
}
