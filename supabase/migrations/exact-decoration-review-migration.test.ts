import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260905000100_exact_decoration_review_matches.sql'),
  'utf8',
);

describe('exact decoration review migration', () => {
  it('shows only complete visual-setting matches and removes similarity blocking', () => {
    expect(sql).toContain("- 'confidence'");
    expect(sql).toContain("approved.published_accessory");
    expect(sql).toContain("public.pet_design_exact_match");
    expect(sql).toContain("'similarityScore',100");
    expect(sql).toContain('select 0;');
  });
});
