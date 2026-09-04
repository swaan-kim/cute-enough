import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260902000100_review_name_correction.sql',
  'utf8',
);

describe('review name correction migration', () => {
  it('validates and saves the final name through a service-role-only RPC', () => {
    expect(sql).toContain('function public.review_pet_submission_v4');
    expect(sql).toContain('INVALID_FINAL_PET_NAME');
    expect(sql).toContain("set name = normalized_name");
    expect(sql).toContain("'review_name_corrected'");
    expect(sql).toContain('to service_role');
  });
});
