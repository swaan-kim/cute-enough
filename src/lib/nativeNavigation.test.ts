import { getInitialSharedPetId } from './nativeNavigation';

describe('initial Apps in Toss route', () => {
  const browserLocation = { pathname: '/', search: '?pet=browser-pet' } as Location;

  it('prefers the Apps in Toss launch scheme', () => {
    expect(getInitialSharedPetId(
      () => 'intoss://cute-enough/pet/scheme-pet',
      browserLocation,
    )).toBe('scheme-pet');
  });

  it('uses the browser URL only when the native bridge is unavailable', () => {
    expect(getInitialSharedPetId(
      () => { throw new Error('bridge unavailable'); },
      browserLocation,
    )).toBe('browser-pet');
  });
});
