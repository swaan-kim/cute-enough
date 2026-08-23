import { getPrivateDeploymentIdFromUri, getSharedPetId, getSharedPetIdFromUri } from './deepLink';

describe('shared pet deep link', () => {
  it('reads a pet id from the route', () => {
    expect(getSharedPetId({ pathname: '/pet/sample-bori', search: '' } as Location)).toBe('sample-bori');
  });

  it('supports the browser preview query parameter', () => {
    expect(getSharedPetId({ pathname: '/', search: '?pet=sample-mandu' } as Location)).toBe('sample-mandu');
  });

  it('reads the production Apps in Toss scheme', () => {
    expect(getSharedPetIdFromUri('intoss://cute-enough/pet/sample-bori')).toBe('sample-bori');
  });

  it('reads the private QR test scheme', () => {
    expect(getSharedPetIdFromUri('intoss-private://cute-enough/pet/sample-mandu')).toBe('sample-mandu');
  });

  it('ignores a scheme for another mini-app', () => {
    expect(getSharedPetIdFromUri('intoss://another-app/pet/sample-bori')).toBeUndefined();
  });

  it('rejects malformed or path-like pet ids', () => {
    expect(getSharedPetIdFromUri('intoss://cute-enough/pet/%2Fadmin')).toBeUndefined();
    expect(getSharedPetIdFromUri('not a url')).toBeUndefined();
  });

  it('keeps the current private deployment id for QR share links', () => {
    const id = '0198c000-68c3-7d2b-0000-2c00000005ec';
    expect(getPrivateDeploymentIdFromUri(`intoss-private://cute-enough?_deploymentId=${id}`)).toBe(id);
    expect(getPrivateDeploymentIdFromUri(`intoss://cute-enough?_deploymentId=${id}`)).toBeUndefined();
    expect(getPrivateDeploymentIdFromUri('intoss-private://another-app?_deploymentId=bad')).toBeUndefined();
  });
});
