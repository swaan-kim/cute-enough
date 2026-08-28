import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260828000600_review_photo_integrity.sql',
  'utf8',
);

describe('review photo integrity migration', () => {
  it('locks the pending pet and requires an active Storage object before approval', () => {
    expect(sql).toContain("status = 'pending' for update");
    expect(sql).toContain('join storage.objects as object');
    expect(sql).toContain("object.bucket_id = 'pet-photos'");
    expect(sql).toContain("raise exception 'PET_PHOTO_MISSING'");
  });
});
