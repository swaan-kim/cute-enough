import { createInitialRouteStack, getCurrentRoute, homeRouteStack, popRoute, pushRoute } from './appRoutes';

describe('app route stack', () => {
  it('starts at home for a normal launch', () => {
    expect(createInitialRouteStack()).toEqual([{ screen: 'home' }]);
  });

  it('starts at the shared landing for a shared pet launch', () => {
    expect(createInitialRouteStack('pet-bori')).toEqual([{ screen: 'shared', petId: 'pet-bori' }]);
  });

  it('returns to the previous app screen', () => {
    const routes = pushRoute(createInitialRouteStack(), { screen: 'mine' });
    const withUpload = pushRoute(routes, { screen: 'upload' });

    expect(getCurrentRoute(popRoute(withUpload))).toEqual({ screen: 'mine' });
  });

  it('keeps the launch route when there is no app screen to pop', () => {
    const sharedRoot = createInitialRouteStack('pet-mandu');
    expect(popRoute(sharedRoot)).toBe(sharedRoot);
  });

  it('returns from play to the shared landing that launched it', () => {
    const sharedRoot = createInitialRouteStack('pet-mandu');
    const playing = pushRoute(sharedRoot, { screen: 'play', petId: 'pet-mandu' });
    expect(getCurrentRoute(popRoute(playing))).toEqual({ screen: 'shared', petId: 'pet-mandu' });
  });

  it('resets any route stack to home', () => {
    expect(homeRouteStack()).toEqual([{ screen: 'home' }]);
  });
});
