import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReviewPhotoAdditions } from './ReviewPhotoAdditions';
import type { ReviewApi, ReviewPhotoAddition } from './types';
const batch: ReviewPhotoAddition = { batchId: 'batch', petId: 'pet', name: '구르미', petStatus: 'approved',
  createdAt: '', expectedRevision: 'a'.repeat(64), photos: [{ photoId: 'one', url: '/one' }, { photoId: 'two', url: '/two' }] };
function mockApi(item = batch) {
  return { getPhotoAdditions: vi.fn().mockResolvedValue([item]),
    reviewPhotoAddition: vi.fn().mockResolvedValue({ batchId: item.batchId, petId: item.petId, status: 'approved' }) } as unknown as ReviewApi;
}
describe('additional photo review', () => {
  it('requires every loaded photo to be checked and an explicit final confirmation', async () => {
    const api = mockApi(); render(<ReviewPhotoAdditions api={api} />);
    const approve = await screen.findByRole('button', { name: '추가 사진 승인' });
    expect(approve).toBeDisabled();
    for (let i=1;i<=2;i++) {
      const checkbox = screen.getByRole('checkbox', { name: `사진 ${i} 확인` });
      expect(checkbox).toBeDisabled();
      fireEvent.load(screen.getByRole('img', { name: `구르미 추가 사진 ${i}` }));
      fireEvent.click(checkbox);
    }
    fireEvent.click(approve); expect(api.reviewPhotoAddition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '확정하기' }));
    await waitFor(() => expect(api.reviewPhotoAddition).toHaveBeenCalledOnce());
    expect(api.reviewPhotoAddition).toHaveBeenCalledWith({ batchId:'batch', expectedRevision:'a'.repeat(64), decision:'approved', note:'' });
  });
  it('allows rejection only with a note, even when a photo cannot load', async () => {
    const api = mockApi({ ...batch, photos: [{ photoId:'one', url:null }] });
    render(<ReviewPhotoAdditions api={api} />);
    const reject = await screen.findByRole('button', { name:'추가 사진 반려' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText('구르미 검수 메모'), { target:{ value:'사진을 다시 부탁드려요' } });
    fireEvent.click(reject); fireEvent.click(screen.getByRole('button', { name:'확정하기' }));
    await waitFor(() => expect(api.reviewPhotoAddition).toHaveBeenCalledWith(expect.objectContaining({ decision:'rejected', note:'사진을 다시 부탁드려요' })));
  });
  it('does not show a pending photo queue as empty on a connection failure', async () => {
    const api=mockApi(); vi.mocked(api.getPhotoAdditions!).mockRejectedValue(new Error('offline'));
    render(<ReviewPhotoAdditions api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('불러오지 못했어요');
    expect(screen.queryByText('검수를 기다리는 추가 사진이 없어요.')).toBeNull();
  });
});
