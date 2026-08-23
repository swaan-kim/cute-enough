function decodePetId(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const value = decodeURIComponent(raw).trim();
    if (!value || value.length > 128 || value.includes('/') || value.includes('\\')) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function readPetId(pathname: string, search: string): string | undefined {
  const pathMatch = pathname.match(/(?:^|\/)pet\/([^/?#]+)/);
  return decodePetId(pathMatch?.[1] ?? new URLSearchParams(search).get('pet'));
}

export function getSharedPetId(location: Pick<Location, 'pathname' | 'search'> = window.location): string | undefined {
  return readPetId(location.pathname, location.search);
}

export function getSharedPetIdFromUri(uri: string): string | undefined {
  if (typeof uri !== 'string' || !uri.trim()) return undefined;
  try {
    const url = new URL(uri, 'https://preview.local');
    if ((url.protocol === 'intoss:' || url.protocol === 'intoss-private:') && url.hostname !== 'cute-enough') {
      return undefined;
    }
    return readPetId(url.pathname, url.search);
  } catch {
    return undefined;
  }
}

export function getPrivateDeploymentIdFromUri(uri: string): string | undefined {
  if (typeof uri !== 'string' || !uri.trim()) return undefined;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'intoss-private:' || url.hostname !== 'cute-enough') return undefined;
    const deploymentId = url.searchParams.get('_deploymentId')?.trim();
    if (!deploymentId || !/^[0-9a-f-]{20,64}$/i.test(deploymentId)) return undefined;
    return deploymentId;
  } catch {
    return undefined;
  }
}
