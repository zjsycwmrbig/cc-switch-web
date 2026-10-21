import { describe, expect, it } from "vitest";
import {
  clearFilteredRoutes,
  routeSlug,
  selectFilteredRoutes,
  type SelectableModelRoute,
  type SelectableRouteResource,
  usableRouteTargets,
} from "@/components/unit/modelSelection";

const resources: SelectableRouteResource[] = [
  { id: "provider-a", routeKey: "a" },
  { id: "provider-b", routeKey: "b" },
];

const autoDeepSeek: SelectableModelRoute = {
  auto: true,
  model: "DeepSeek V4",
  targets: [],
};
const directDeepSeek: SelectableModelRoute = {
  auto: false,
  model: "DeepSeek V4",
  targets: ["provider-a"],
};
const directKimi: SelectableModelRoute = {
  auto: false,
  model: "Kimi K2",
  targets: ["provider-b"],
};
const directGlm: SelectableModelRoute = {
  auto: false,
  model: "GLM 5",
  targets: ["provider-a"],
};
const routes = [autoDeepSeek, directDeepSeek, directKimi, directGlm];
const slug = (route: SelectableModelRoute) => routeSlug(route, resources);

describe("model selection helpers", () => {
  it("映射编辑只暴露可用目标并保留原始索引", () => {
    expect(
      usableRouteTargets({
        auto: true,
        model: "DeepSeek V4",
        targets: ["down", "healthy", "unknown"],
        targetDetails: [
          { id: "down", usable: false },
          { id: "healthy", usable: true },
          { id: "unknown" },
        ],
      }),
    ).toEqual([
      { id: "healthy", index: 1 },
      { id: "unknown", index: 2 },
    ]);
  });

  it("全选只增加当前筛选结果，并保留筛选外的选择", () => {
    const selected = new Set([slug(directGlm)]);

    expect(
      selectFilteredRoutes(
        routes,
        [directDeepSeek, directKimi],
        resources,
        selected,
      ),
    ).toEqual(
      new Set([slug(directGlm), slug(directDeepSeek), slug(directKimi)]),
    );
  });

  it("筛选结果中的自动路由会折叠筛选外同模型的直连路由", () => {
    const selected = new Set([slug(directDeepSeek), slug(directGlm)]);

    expect(
      selectFilteredRoutes(routes, [autoDeepSeek], resources, selected),
    ).toEqual(new Set([slug(autoDeepSeek), slug(directGlm)]));
  });

  it("清空只移除当前筛选结果，并保留筛选外的选择", () => {
    const selected = new Set([
      slug(directDeepSeek),
      slug(directKimi),
      slug(directGlm),
    ]);

    expect(
      clearFilteredRoutes([directDeepSeek, directKimi], resources, selected),
    ).toEqual(new Set([slug(directGlm)]));
  });
});
