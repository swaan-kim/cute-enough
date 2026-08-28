import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260828000800_house_snapshot_owner_photo.sql',
  'utf8',
);

describe('house snapshot and owner photo migration', () => {
  it('adds ownerPhoto to the server-side rate-limit constraint', () => {
    expect(sql).toContain("'ownerPhoto'");
    expect(sql).toContain('pet_api_rate_limits_action_check');
  });

  it('serializes house allowance and revisit state against reveal writes', () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('pet-reveal:' || p_owner_hash, 0))");
    expect(sql).toContain('get_pet_free_allowance(p_owner_hash)');
    expect(sql).toContain("'activeReveals'");
    expect(sql).toContain("'uploadReward'");
    expect(sql.indexOf('perform pg_advisory_xact_lock')).toBeLessThan(sql.indexOf('v_now := clock_timestamp()'));
  });

  it('admits approved pets to a different user house only after the KST approval date', () => {
    expect(sql).toContain("p_date::timestamp at time zone 'Asia/Seoul'");
    expect(sql).toContain('coalesce(pet.reviewed_at, pet.created_at) < v_day_start');
  });

  it('requires an active DB row backed by a real private Storage object', () => {
    expect(sql).toContain('function public.get_existing_pet_photos');
    expect(sql).toContain("object.bucket_id = 'pet-photos'");
    expect(sql).toContain('object.name = photo.storage_path');
  });

  it('keeps the review queue and integrity operations service-role only', () => {
    expect(sql).toContain('view public.pending_pet_review_queue');
    expect(sql).toContain('function public.pause_pet_publication');
    expect(sql).toContain('function public.reconcile_missing_pet_photos');
    expect(sql).toContain('grant select on table public.pending_pet_review_queue');
    expect(sql).toContain('to service_role');
  });

  it('deactivates photos and pauses publication atomically', () => {
    expect(sql).toContain('set is_active = false');
    expect(sql).toContain("set status = 'paused'");
    expect(sql).toContain("'pause_publication'");
  });
});
