function stablePoolScore(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 서버의 공개 후보를 사용자와 KST 날짜별로 결정적으로 섞는다. */
export function orderDailyPets<T extends { id: string }>(pets: T[], ownerHash: string, date: string): T[] {
  return [...pets].sort((left, right) => {
    const leftScore = stablePoolScore(`daily-pool-v1:${ownerHash}:${date}:${left.id}`);
    const rightScore = stablePoolScore(`daily-pool-v1:${ownerHash}:${date}:${right.id}`);
    return leftScore - rightScore || left.id.localeCompare(right.id);
  });
}
