/**
 * 추가로 전달받는 캐릭터 이미지를 연결하는 단일 진입점이에요.
 * public/pet-artwork 아래에 파일을 넣고 pet id와 경로만 연결하면
 * 집·교감·업로드 미리보기에 같은 비주얼 규칙이 적용돼요.
 */
export const PET_ARTWORK: Readonly<Record<string, string>> = {
  // 'sample-bori': '/pet-artwork/sample-bori.webp',
};

export function getPetArtwork(petId?: string, remoteUrl?: string): string | undefined {
  if (remoteUrl) return remoteUrl;
  if (!petId) return undefined;
  return PET_ARTWORK[petId];
}
