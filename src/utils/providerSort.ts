// 统一各入口的名称排序，不使用旧排名或供应商身份。
const providerNameCollator = new Intl.Collator("en", { sensitivity: "base" });

export function compareProviderNames(left: string, right: string): number {
  return providerNameCollator.compare(left.trim(), right.trim());
}

export function sortProvidersByName<T extends { name: string }>(
  providers: readonly T[],
): T[] {
  return [...providers].sort((left, right) =>
    compareProviderNames(left.name, right.name),
  );
}
