export function withSubjectParticle(value: string): string {
  const last = value.at(-1);
  if (!last) return value;
  const code = last.charCodeAt(0);
  const isHangulSyllable = code >= 0xAC00 && code <= 0xD7A3;
  const hasFinalConsonant = isHangulSyllable && (code - 0xAC00) % 28 !== 0;
  return `${value}${hasFinalConsonant ? '이' : '가'}`;
}
