import { describe, expect, it } from 'vitest';
import { collectKeysetPages } from './keyset-pagination';

describe('owner history pagination', () => {
  it('returns more than the default 1,000-row cap, including equal timestamps and deleted history', async () => {
    const rows = Array.from({ length: 1251 }, (_, i) => ({
      id: String(2000 - i).padStart(6, '0'), created_at: '2026-09-05T00:00:00Z',
      status: i % 2 ? 'deleted' : 'approved',
    }));
    let calls = 0;
    const actual = await collectKeysetPages(async (cursor, size) => {
      calls++;
      return rows.filter((row) => !cursor || row.created_at < cursor.created_at
        || (row.created_at === cursor.created_at && row.id < cursor.id)).slice(0, size);
    });
    expect(actual).toEqual(rows);
    expect(calls).toBe(7);
  });

  it('fails if a page fails instead of presenting a partial history as complete', async () => {
    let calls = 0;
    await expect(collectKeysetPages(async () => {
      if (++calls === 2) throw new Error('database unavailable');
      return [{ id: '2', created_at: '2026-09-05' }];
    }, 1)).rejects.toThrow('database unavailable');
  });

  it('stops a nonadvancing database cursor instead of looping forever', async () => {
    await expect(collectKeysetPages(async () => [{ id: '2', created_at: '2026-09-05' }], 1))
      .rejects.toThrow('PAGINATION_DID_NOT_ADVANCE');
  });
});
