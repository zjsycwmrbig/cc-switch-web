export interface SelectableModelRoute {
  auto: boolean;
  model: string;
  targets: string[];
}

export interface SelectableRouteResource {
  id: string;
  routeKey: string;
}

export interface RouteTargetDetail {
  id: string;
  usable?: boolean;
}

export interface RoutedModelRoute extends SelectableModelRoute {
  targetDetails?: RouteTargetDetail[];
}

export function usableRouteTargets(route: RoutedModelRoute) {
  return route.targets.flatMap((id, index) => {
    const detail = route.targetDetails?.find((item) => item.id === id);
    return detail?.usable === false ? [] : [{ id, index }];
  });
}

export function routeSlug(
  route: SelectableModelRoute,
  resources: SelectableRouteResource[],
) {
  if (route.auto) return `ccs-auto/${route.model}`;
  const resource = resources.find((item) => item.id === route.targets[0]);
  return `ccs-${resource?.routeKey ?? "auto"}/${route.model}`;
}

export function modelGroupKey(value: string) {
  return value
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function collapseSelectedRoutes(
  routes: SelectableModelRoute[],
  resources: SelectableRouteResource[],
  selected: Set<string>,
) {
  const next = new Set(selected);
  const autoGroups = new Set(
    routes
      .filter((route) => route.auto && next.has(routeSlug(route, resources)))
      .map((route) => modelGroupKey(route.model)),
  );
  for (const route of routes) {
    if (!route.auto && autoGroups.has(modelGroupKey(route.model))) {
      next.delete(routeSlug(route, resources));
    }
  }
  return next;
}

export function selectFilteredRoutes(
  allRoutes: SelectableModelRoute[],
  filteredRoutes: SelectableModelRoute[],
  resources: SelectableRouteResource[],
  selected: Set<string>,
) {
  const next = new Set(selected);
  for (const route of filteredRoutes) {
    next.add(routeSlug(route, resources));
  }
  return collapseSelectedRoutes(allRoutes, resources, next);
}

export function clearFilteredRoutes(
  filteredRoutes: SelectableModelRoute[],
  resources: SelectableRouteResource[],
  selected: Set<string>,
) {
  const next = new Set(selected);
  for (const route of filteredRoutes) {
    next.delete(routeSlug(route, resources));
  }
  return next;
}
