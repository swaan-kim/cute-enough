import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnedPetSummary, PhotoAdditionStatus, SubmitPhotoAdditionInput } from '../types';

const mocks = vi.hoisted(() => ({
  fetchStatus: vi.fn(), submit: vi.fn(), pick: vi.fn(), browserPick: vi.fn(), normalize: vi.fn(),
}));
vi.mock('../lib/petPhotoAdditions', () => ({ fetchPhotoAdditionStatus: mocks.fetchStatus, submitPhotoAddition: mocks.submit }));
vi.mock('../lib/petImage', () => ({ normalizeAndAnalyzePetImage: mocks.normalize }));
vi.mock('../lib/toss', () => ({
  pickPhotos: mocks.pick,
  pickPhotosFromBrowser: mocks.browserPick,
  isPhotoPickerUnavailableError: (error: unknown) => Boolean(error && typeof error === 'object' && 'useBrowserFallback' in error && error.useBrowserFallback),
}));
vi.mock('@toss/tds-mobile', () => {
  const TopRoot = ({ title, subtitleBottom }: { title?: ReactNode; subtitleBottom?: ReactNode }) => <header>{title}{subtitleBottom}</header>;
  return {
    Top: Object.assign(TopRoot, {
      TitleParagraph: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>,
      SubtitleParagraph: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
    }),
    Button: ({ children, display: _display, size: _size, color: _color, variant: _variant, loading: _loading, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode; display?: string; size?: string; color?: string; variant?: string; loading?: boolean }) => <button {...props}>{children}</button>,
  };
});

import { PetApiError } from '../lib/api';
import { PetPhotoAdditionFlow } from './PetPhotoAdditionFlow';

const pet: OwnedPetSummary = {
  id: 'existing-dog', name: '구르미', approvalStatus: 'approved', ownerPhotoAvailable: true,
  designVersion: 3,
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 },
};
const availableStatus: PhotoAdditionStatus = { petId: pet.id, activePhotoCount: 3, pendingPhotoCount: 0, maxPhotoCount: 5, remainingCount: 2, canSubmit: true };
const sourcePhotos = ['data:image/png;base64,FIRST', 'data:image/webp;base64,SECOND'];
const normalized = (source: string) => `data:image/jpeg;base64,NORMALIZED-${source.split(',')[1]}`;

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.fetchStatus.mockResolvedValue(availableStatus);
  mocks.pick.mockResolvedValue([sourcePhotos[0]]);
  mocks.normalize.mockImplementation(async (source: string) => ({ dataUri: normalized(source), traits: { ...pet.traits, earShape: 'upright' }, brightness: 180 }));
  mocks.submit.mockImplementation(async (input: SubmitPhotoAdditionInput) => ({ submission: { petId: input.petId, submissionId: input.submissionId, status: 'pending', photoCount: input.dataUris.length, createdAt: '2026-09-06T00:00:00Z' }, remainingCount: availableStatus.remainingCount - input.dataUris.length }));
});

function renderFlow(onSubmitted = vi.fn(), onCancel = vi.fn()) {
  return { ...render(<PetPhotoAdditionFlow pet={pet} onSubmitted={onSubmitted} onCancel={onCancel} />), onSubmitted, onCancel };
}

async function selectPhotos() {
  fireEvent.click(await screen.findByRole('button', { name: /강아지 사진 고르기/ }));
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
}

async function prepareSubmission() {
  const result = renderFlow();
  await selectPhotos();
  fireEvent.click(screen.getByRole('checkbox'));
  return result;
}

describe('PetPhotoAdditionFlow', () => {
  it('loads owner status before opening the picker and displays the total remaining capacity', async () => {
    let resolveStatus!: (status: PhotoAdditionStatus) => void;
    mocks.fetchStatus.mockReturnValueOnce(new Promise((resolve) => { resolveStatus = resolve; }));
    renderFlow();
    expect(mocks.fetchStatus).toHaveBeenCalledWith(pet.id);
    expect(screen.getByRole('status')).toHaveTextContent('확인하고 있어요');
    expect(screen.queryByRole('button', { name: /사진 고르기/ })).not.toBeInTheDocument();
    await act(async () => resolveStatus(availableStatus));
    expect(screen.getByText('기존 사진 3장 · 검수 중 0장')).toBeInTheDocument();
    expect(screen.getByText('최대 5장 중 2장 더 올릴 수 있어요')).toBeInTheDocument();
    await selectPhotos();
    expect(mocks.pick).toHaveBeenCalledWith(2);
  });

  it.each([5, 7])('preserves an existing %i-photo dog and blocks new selection at or above five', async (activePhotoCount) => {
    mocks.fetchStatus.mockResolvedValue({ ...availableStatus, activePhotoCount, remainingCount: 0, canSubmit: false });
    renderFlow();
    expect(await screen.findByText(`기존 사진 ${activePhotoCount}장 · 검수 중 0장`)).toBeInTheDocument();
    expect(screen.getByText(/기존 사진은 그대로 보관돼요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /사진 고르기/ })).not.toBeInTheDocument();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it('waits for a pending batch even when there is another slot left', async () => {
    mocks.fetchStatus.mockResolvedValue({ ...availableStatus, pendingPhotoCount: 1, remainingCount: 1, canSubmit: false,
      submission: { petId: pet.id, submissionId: 'pending-batch', status: 'pending', photoCount: 1, createdAt: '2026-09-06T00:00:00Z' } });
    renderFlow();
    expect(await screen.findByText('기존 사진 3장 · 검수 중 1장')).toBeInTheDocument();
    expect(screen.getByText('새로운 귀여움도 검수 중이에요. 확인이 끝나면 이 친구의 앨범에 살포시 더해져요 🐾')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /사진 고르기/ })).not.toBeInTheDocument();
  });

  it('shows rejection feedback as text and allows another selection within capacity', async () => {
    const reviewNote = '<img src=x onerror=alert(1)> 얼굴이 잘 보이는 사진을 골라주세요.';
    mocks.fetchStatus.mockResolvedValue({ ...availableStatus, submission: { petId: pet.id, submissionId: 'rejected-batch', status: 'rejected', photoCount: 2, createdAt: '2026-09-06T00:00:00Z', reviewNote } });
    const { container } = renderFlow();
    expect(await screen.findByText(reviewNote)).toBeInTheDocument();
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(screen.getByRole('button', { name: /강아지 사진 고르기/ })).toBeEnabled();
  });

  it('does not open a picker on an ownership or state load error and supports a safe read retry', async () => {
    mocks.fetchStatus.mockRejectedValueOnce(new PetApiError('내가 소개한 강아지에만 사진을 더 올릴 수 있어요.', 'PHOTO_ADDITION_FORBIDDEN', 'definite', 403));
    renderFlow();
    expect(await screen.findByRole('alert')).toHaveTextContent('내가 소개한 강아지에만');
    expect(screen.queryByRole('button', { name: /사진 고르기/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 확인하기' }));
    expect(await screen.findByRole('button', { name: /강아지 사진 고르기/ })).toBeEnabled();
    expect(mocks.fetchStatus).toHaveBeenCalledTimes(2);
    expect(mocks.pick).not.toHaveBeenCalled();
  });

  it('adds normalized photos to the same dog without name, appearance, or new-dog fields', async () => {
    const before = JSON.stringify(pet);
    mocks.pick.mockResolvedValue(sourcePhotos);
    const { onSubmitted } = await prepareSubmission();
    expect(screen.getByRole('heading')).toHaveTextContent('구르미의사진을 더 모아요');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText(/기존에 공개된 사진은 그대로 보여요/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '사진 2장 검수 보내기' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledWith({ petId: pet.id, submissionId: expect.any(String), dataUris: sourcePhotos.map(normalized) });
    expect(Object.keys(mocks.submit.mock.calls[0][0]).sort()).toEqual(['dataUris', 'petId', 'submissionId']);
    expect(JSON.stringify(pet)).toBe(before);
  });

  it('rejects picker over-selection explicitly without discarding photos silently', async () => {
    mocks.pick.mockResolvedValue([...sourcePhotos, 'data:image/jpeg;base64,THIRD']);
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: /강아지 사진 고르기/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('지금은 사진을 2장까지 더 고를 수 있어요.');
    expect(mocks.normalize).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('normalizes sequentially, shows each preview, and supports retry and deletion', async () => {
    let resolveFirst!: (value: { dataUri: string }) => void;
    mocks.pick.mockResolvedValue(sourcePhotos);
    mocks.normalize.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; })).mockRejectedValueOnce(new Error('사진을 읽지 못했어요.'));
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: /강아지 사진 고르기/ }));
    await waitFor(() => expect(mocks.normalize).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '사진 2장 검수 보내기' })).toBeDisabled();
    await act(async () => resolveFirst({ dataUri: normalized(sourcePhotos[0]) }));
    const retry = await screen.findByRole('button', { name: '2번 사진 다시 시도하기' });
    expect(mocks.normalize).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toHaveTextContent('2번 사진: 사진을 읽지 못했어요.');
    fireEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '2번 사진 크게 보기' }));
    expect(screen.getByAltText('2번 추가 사진 미리보기')).toHaveAttribute('src', normalized(sourcePhotos[1]));
    fireEvent.click(screen.getByRole('button', { name: '1번 사진 삭제' }));
    expect(screen.getByText('고른 사진 1/2')).toBeInTheDocument();
    expect(screen.getByAltText('1번 추가 사진 미리보기')).toHaveAttribute('src', normalized(sourcePhotos[1]));
    expect(mocks.normalize).toHaveBeenCalledTimes(3);
  });

  it('requires renewed consent when the selected photo set changes', async () => {
    await prepareSubmission();
    expect(screen.getByRole('button', { name: '사진 1장 검수 보내기' })).toBeEnabled();
    mocks.pick.mockResolvedValueOnce([sourcePhotos[1]]);
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    expect(mocks.pick).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('button', { name: '사진 2장 검수 보내기' })).toBeDisabled();
  });

  it('retries through a user-initiated browser picker when Toss selection is unavailable', async () => {
    mocks.pick.mockRejectedValueOnce(Object.assign(new Error('한 번 더 눌러 사진을 골라주세요.'), { useBrowserFallback: true }));
    mocks.browserPick.mockResolvedValueOnce([sourcePhotos[0]]);
    renderFlow();
    fireEvent.click(await screen.findByRole('button', { name: /강아지 사진 고르기/ }));
    fireEvent.click(await screen.findByRole('button', { name: /기기에서 사진 고르기/ }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled());
    expect(mocks.browserPick).toHaveBeenCalledWith(2);
    expect(mocks.normalize).toHaveBeenCalledWith(sourcePhotos[0]);
  });

  it('recovers a committed unknown outcome by its exact ID without submitting another batch', async () => {
    mocks.submit.mockRejectedValueOnce(new PetApiError('응답을 확인하지 못했어요.', 'NETWORK_ERROR', 'unknown'));
    mocks.fetchStatus.mockImplementation(async (petId: string, submissionId?: string) => submissionId
      ? { ...availableStatus, found: true, submission: { petId, submissionId, status: 'pending', photoCount: 1, createdAt: '2026-09-06T00:00:00Z' } }
      : availableStatus);
    const { onSubmitted } = await prepareSubmission();
    fireEvent.click(screen.getByRole('button', { name: '사진 1장 검수 보내기' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(mocks.fetchStatus).toHaveBeenLastCalledWith(pet.id, mocks.submit.mock.calls[0][0].submissionId);
    expect(mocks.submit).toHaveBeenCalledOnce();
  });

  it('locks editing and exit for an unknown outcome and retries only the frozen payload after an exact not-found response', async () => {
    mocks.submit.mockRejectedValueOnce(new PetApiError('응답을 확인하지 못했어요.', 'NETWORK_ERROR', 'unknown'));
    mocks.fetchStatus.mockResolvedValueOnce(availableStatus).mockRejectedValueOnce(new Error('연결이 끊겼어요.')).mockResolvedValueOnce({ ...availableStatus, found: false });
    const dirtyEvents: Array<{ dirty: boolean; busy: boolean }> = [];
    const listener = (event: Event) => dirtyEvents.push((event as CustomEvent).detail);
    window.addEventListener('cute-enough:upload-dirty-change', listener);
    const { onSubmitted, onCancel } = await prepareSubmission();
    fireEvent.click(screen.getByRole('button', { name: '사진 1장 검수 보내기' }));
    expect(await screen.findByRole('button', { name: '사진 접수 상태 확인하기' })).toBeEnabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '1번 사진 삭제' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '사진 추가하기' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '내 강아지로 돌아가기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '내 강아지로 돌아가기' }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(dirtyEvents.at(-1)).toEqual({ dirty: true, busy: true });
    const original = mocks.submit.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: '사진 접수 상태 확인하기' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.submit.mock.calls[1][0]).toBe(original);
    expect(mocks.fetchStatus).toHaveBeenLastCalledWith(pet.id, original.submissionId);
    window.removeEventListener('cute-enough:upload-dirty-change', listener);
  });

  it('does not mistake another batch for the frozen request or retry an ambiguous status', async () => {
    mocks.submit.mockRejectedValueOnce(new PetApiError('응답을 확인하지 못했어요.', 'NETWORK_ERROR', 'unknown'));
    mocks.fetchStatus.mockResolvedValueOnce(availableStatus).mockResolvedValue({ ...availableStatus, found: true, submission: { petId: pet.id, submissionId: 'different-batch', status: 'pending', photoCount: 1, createdAt: '2026-09-06T00:00:00Z' } });
    const { onSubmitted } = await prepareSubmission();
    fireEvent.click(screen.getByRole('button', { name: '사진 1장 검수 보내기' }));
    fireEvent.click(await screen.findByRole('button', { name: '사진 접수 상태 확인하기' }));
    expect(await screen.findByRole('button', { name: '사진 접수 상태 확인하기' })).toBeEnabled();
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('retains the original lock if a retry after an unknown outcome fails definitively', async () => {
    mocks.submit.mockRejectedValueOnce(new PetApiError('응답을 확인하지 못했어요.', 'NETWORK_ERROR', 'unknown'))
      .mockRejectedValueOnce(new PetApiError('지금은 사진을 추가할 수 없어요.', 'PHOTO_ADDITION_UNAVAILABLE', 'definite', 409));
    mocks.fetchStatus.mockResolvedValueOnce(availableStatus).mockResolvedValue({ ...availableStatus, found: false });
    const { onSubmitted } = await prepareSubmission();
    fireEvent.click(screen.getByRole('button', { name: '사진 1장 검수 보내기' }));
    fireEvent.click(await screen.findByRole('button', { name: '사진 접수 상태 확인하기' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: '사진 접수 상태 확인하기' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '1번 사진 삭제' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '내 강아지로 돌아가기' })).toBeDisabled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('freezes the request immediately to prevent repeated submit clicks', async () => {
    let resolveSubmission!: (result: unknown) => void;
    mocks.submit.mockReturnValueOnce(new Promise((resolve) => { resolveSubmission = resolve; }));
    const { onSubmitted } = await prepareSubmission();
    const button = screen.getByRole('button', { name: '사진 1장 검수 보내기' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '내 강아지로 돌아가기' })).toBeDisabled();
    await act(async () => resolveSubmission({}));
    expect(onSubmitted).toHaveBeenCalledOnce();
  });

  it('refreshes the capacity after a definite server limit conflict', async () => {
    mocks.submit.mockRejectedValueOnce(new PetApiError('사진은 0장 더 올릴 수 있어요.', 'PHOTO_ADDITION_LIMIT_REACHED', 'definite', 409));
    mocks.fetchStatus.mockResolvedValueOnce(availableStatus).mockResolvedValueOnce({ ...availableStatus, activePhotoCount: 5, remainingCount: 0, canSubmit: false });
    await prepareSubmission();
    fireEvent.click(screen.getByRole('button', { name: '사진 1장 검수 보내기' }));
    expect(await screen.findByText('기존 사진 5장 · 검수 중 0장')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /검수 보내기/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('사진은 0장 더 올릴 수 있어요.');
    expect(screen.getByRole('button', { name: '내 강아지로 돌아가기' })).toBeEnabled();
  });

  it('marks a selected draft dirty, clears the marker on unmount, and discards the draft when switching dogs', async () => {
    const onSubmitted = vi.fn();
    const onCancel = vi.fn();
    const result = renderFlow(onSubmitted, onCancel);
    await selectPhotos();
    expect(document.documentElement.dataset.uploadDraftDirty).toBe('true');
    const otherPet = { ...pet, id: 'other-dog', name: '보리' };
    mocks.fetchStatus.mockResolvedValueOnce({ ...availableStatus, petId: otherPet.id });
    result.rerender(<PetPhotoAdditionFlow pet={otherPet} onSubmitted={onSubmitted} onCancel={onCancel} />);
    expect(await screen.findByRole('button', { name: /강아지 사진 고르기/ })).toBeEnabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(document.documentElement.dataset.uploadDraftDirty).toBe('false');
    result.unmount();
    expect(document.documentElement.dataset.uploadDraftDirty).toBeUndefined();
  });
});
