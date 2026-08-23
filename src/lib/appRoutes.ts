import type { AppRoute } from '../types';

export function createInitialRouteStack(sharedPetId?: string): AppRoute[] {
  return sharedPetId
    ? [{ screen: 'shared', petId: sharedPetId }]
    : [{ screen: 'home' }];
}

export function getCurrentRoute(routes: AppRoute[]): AppRoute {
  return routes.at(-1) ?? { screen: 'home' };
}

export function pushRoute(routes: AppRoute[], route: AppRoute): AppRoute[] {
  return [...routes, route];
}

export function popRoute(routes: AppRoute[]): AppRoute[] {
  return routes.length > 1 ? routes.slice(0, -1) : routes;
}

export function homeRouteStack(): AppRoute[] {
  return [{ screen: 'home' }];
}
