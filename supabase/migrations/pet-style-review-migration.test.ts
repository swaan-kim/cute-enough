import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260901000100_pet_styles_and_design_review.sql',
  'utf8',
);

describe('pet style and design review migration', () => {
  it('preserves submitted traits and style separately from the reviewed design', () => {
    expect(sql).toContain('submitted_traits jsonb');
    expect(sql).toContain('submitted_style jsonb');
    expect(sql).toContain('published_style jsonb');
    expect(sql).toContain('function public.register_pet_submission_v3');
  });

  it('enforces solid and point coat invariants on the server', () => {
    expect(sql).toContain("p_style->>'coatMode' = 'solid'");
    expect(sql).toContain("p_traits->>'baseColor' = p_traits->>'secondaryColor'");
    expect(sql).toContain("p_traits->>'markingPattern' = 'none'");
    expect(sql).toContain("p_style->>'coatMode' = 'point'");
  });

  it('records atomic before and after designs and protects highly similar unchanged approvals', () => {
    expect(sql).toContain('function public.review_pet_submission_v3');
    expect(sql).toContain("raise exception 'SIMILARITY_REVIEW_NOTE_REQUIRED'");
    expect(sql).toContain("'before'");
    expect(sql).toContain("'after'");
    expect(sql).toContain("status = 'pending' for update");
  });

  it('supports reviewed-dog search, correction, pause, and republish for service role only', () => {
    expect(sql).toContain('view public.pet_review_catalog');
    expect(sql).toContain('function public.manage_pet_publication_v3');
    expect(sql).toContain("p_action not in ('revise','pause','republish')");
    expect(sql).toContain('grant select on table public.pet_review_catalog to service_role');
  });
});
