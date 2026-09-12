import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoatColor, EarShape, MarkingPattern, PetTraitsV1, SubmitPetResult } from '../types';

const uploadMocks = vi.hoisted(() => ({
  pickPhotos: vi.fn<(maxCount?: number) => Promise<string[]>>(),
  pickPhotosFromBrowser: vi.fn<(maxCount?: number) => Promise<string[]>>(),
  normalizeAndAnalyzePetImage: vi.fn(),
  fetchSubmissionStatus: vi.fn(),
  submitPet: vi.fn(),
}));

vi.mock('../lib/toss', () => ({
  pickPhotos: uploadMocks.pickPhotos,
  pickPhotosFromBrowser: uploadMocks.pickPhotosFromBrowser,
  isPhotoPickerUnavailableError: (error: unknown) => Boolean(
    error && typeof error === 'object' && 'useBrowserFallback' in error
      && (error as { useBrowserFallback?: unknown }).useBrowserFallback === true,
  ),
}));
vi.mock('../lib/petImage', () => ({ normalizeAndAnalyzePetImage: uploadMocks.normalizeAndAnalyzePetImage }));
vi.mock('../lib/api', async () => ({
  ...await vi.importActual<typeof import('../lib/api')>('../lib/api'),
  fetchSubmissionStatus: uploadMocks.fetchSubmissionStatus,
  submitPet: uploadMocks.submitPet,
}));

import { CoatColorPickers, CoatModePicker, EarShapePicker, FaceMarkingPicker, FurStylePicker, UploadFlow } from './UploadFlow';
import { PetApiError } from '../lib/api';

const traits: PetTraitsV1 = {
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'white',
  secondaryColor: 'cream',
  markingPattern: 'brow',
  muzzle: 'short',
  confidence: 1,
};

const normalizedPhoto = 'data:image/jpeg;base64,NORMALIZED';
const submittedResult: SubmitPetResult = {
  pet: {
    id: 'uploaded-pet',
    name: '하늘',
    traits,
    approvalStatus: 'pending',
    isMine: true,
    ownerPinned: true,
    shareable: true,
    photoAvailable: true,
  },
  rewardGranted: true,
  uploadRewardPetId: 'uploaded-pet',
};

beforeEach(() => {
  uploadMocks.pickPhotos.mockReset();
  uploadMocks.pickPhotosFromBrowser.mockReset();
  uploadMocks.normalizeAndAnalyzePetImage.mockReset();
  uploadMocks.fetchSubmissionStatus.mockReset();
  uploadMocks.submitPet.mockReset();
});

async function prepareUploadFlow(onSubmitted = vi.fn(), initialName = '하늘') {
  uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,SOURCE']);
  uploadMocks.normalizeAndAnalyzePetImage.mockResolvedValueOnce({
    dataUri: normalizedPhoto,
    traits,
    brightness: 180,
  });
  render(
    <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
      <UploadFlow onSubmitted={onSubmitted} />
    </TDSMobileAITProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: /강아지 사진 고르기/ }));
  fireEvent.change(await screen.findByPlaceholderText('예: 보리'), { target: { value: initialName } });
  fireEvent.click(screen.getByRole('checkbox'));
  return onSubmitted;
}

describe('UploadFlow introduction', () => {
  it('explains the immediate owner view and approval boundary before photo selection', () => {
    const { container } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <UploadFlow onSubmitted={() => undefined} />
      </TDSMobileAITProvider>,
    );

    expect(screen.getByRole('heading', { name: /우리 집 강아지를 소개해 주세요/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /강아지 사진 고르기/ })).toBeInTheDocument();
    expect(screen.getByText('내 집에 바로 나타나요')).toBeInTheDocument();
    expect(screen.getByText('승인 전 공유 링크에는 캐릭터만 보여요.')).toBeInTheDocument();
    expect(screen.getByText('승인되면 모두가 만나요')).toBeInTheDocument();
    expect(screen.getByText('운영자가 귀여움을 꼼꼼히 확인한 뒤, 친구들에게 한 장씩 보여드려요 🐾')).toBeInTheDocument();
    expect(screen.getByText('JPG, PNG, WEBP · 1~5장')).toBeInTheDocument();
    expect(container.querySelectorAll('.upload-step-heading')).toHaveLength(1);
    expect(container.querySelectorAll('.upload-flow-guide > div > span')).toHaveLength(3);
    expect(container.querySelector('.upload-flow-guide')).not.toHaveTextContent('1내 집에 바로 나타나요');
  });

  it('turns the same photo button into a web picker retry when the Toss picker cannot open', async () => {
    uploadMocks.pickPhotos.mockRejectedValueOnce(Object.assign(
      new Error('토스 사진 선택창을 열지 못했어요. 한 번 더 눌러 기기 사진을 골라주세요.'),
      { useBrowserFallback: true },
    ));
    uploadMocks.pickPhotosFromBrowser.mockResolvedValueOnce(['data:image/png;base64,FALLBACK']);
    uploadMocks.normalizeAndAnalyzePetImage.mockResolvedValueOnce({
      dataUri: normalizedPhoto,
      traits,
      brightness: 180,
    });
    render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <UploadFlow onSubmitted={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /강아지 사진 고르기/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('한 번 더 눌러 기기 사진을 골라주세요.');

    fireEvent.click(screen.getByRole('button', { name: /기기에서 사진 고르기/ }));
    expect(uploadMocks.pickPhotosFromBrowser).toHaveBeenCalledOnce();
    expect(await screen.findByPlaceholderText('예: 보리')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '캐릭터 만들어보기' })).not.toBeInTheDocument();
  });

  it('starts local compression and color analysis immediately, then offers retry only after failure', async () => {
    let rejectAnalysis!: (error: Error) => void;
    uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,SOURCE']);
    uploadMocks.normalizeAndAnalyzePetImage
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectAnalysis = reject; }))
      .mockResolvedValueOnce({ dataUri: normalizedPhoto, traits, brightness: 180 });
    render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <UploadFlow onSubmitted={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /강아지 사진 고르기/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('사진을 살펴보고 있어요');
    expect(uploadMocks.normalizeAndAnalyzePetImage).toHaveBeenCalledWith('data:image/png;base64,SOURCE');
    expect(screen.queryByRole('button', { name: '캐릭터 만들어보기' })).not.toBeInTheDocument();

    await act(async () => rejectAnalysis(new Error('분석을 마치지 못했어요.')));
    expect(await screen.findByRole('button', { name: '1번 사진 다시 시도하기' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1번 사진 다시 시도하기' }));
    expect(await screen.findByPlaceholderText('예: 보리')).toBeInTheDocument();
    expect(uploadMocks.normalizeAndAnalyzePetImage).toHaveBeenCalledTimes(2);
  });

  it('marks the name as required and explains an empty field after leaving it', async () => {
    await prepareUploadFlow(vi.fn(), '');
    const input = screen.getByRole('textbox', { name: '강아지 이름' });
    const submit = screen.getByRole('button', { name: '이 모습으로 소개하기' });
    expect(input).toBeRequired();
    expect(submit).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.blur(input);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('강아지 이름을 입력해 주세요.');
    fireEvent.click(submit);
    expect(uploadMocks.submitPet).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '콩' } });
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it.each(['', '   ', '\t\n', '\u200B\uFEFF', '\u3164\uFFA0', '보리♥', '관리자'])('blocks registration with an invalid name: %j', async (value) => {
    await prepareUploadFlow();
    const input = screen.getByRole('textbox', { name: '강아지 이름' });
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    const submit = screen.getByRole('button', { name: '이 모습으로 소개하기' });
    expect(submit).toBeDisabled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(submit);
    expect(uploadMocks.submitPet).not.toHaveBeenCalled();
  });

  it('submits the normalized visible name without surrounding spaces', async () => {
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    await prepareUploadFlow(vi.fn(), '  하\u200B늘  ');
    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));
    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledWith(expect.objectContaining({ name: '하늘' })));
  });

  it('carries the selected photo, name, confirmed traits, and consent through submission', async () => {
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    const onSubmitted = vi.fn();
    await prepareUploadFlow(onSubmitted);
    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));

    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledOnce());
    expect(uploadMocks.submitPet).toHaveBeenCalledWith({
      submissionId: expect.any(String),
      dataUris: [normalizedPhoto],
      name: '하늘',
      traits,
      style: { schemaVersion: 1, coatMode: 'point', furStyle: 'neat' },
      accessorySelectionMode: 'reviewer',
      requestedAccessory: undefined,
    });
    expect(onSubmitted).toHaveBeenCalledWith(submittedResult);
  });

  it('finishes from owner-scoped status when the upload response times out after commit', async () => {
    uploadMocks.submitPet.mockRejectedValueOnce(new PetApiError('요청 결과를 아직 확인하지 못했어요.', 'REQUEST_TIMEOUT', 'unknown'));
    uploadMocks.fetchSubmissionStatus.mockResolvedValueOnce({ found: true, result: submittedResult });
    const onSubmitted = await prepareUploadFlow();

    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(submittedResult));
    expect(uploadMocks.submitPet).toHaveBeenCalledOnce();
    const submitted = uploadMocks.submitPet.mock.calls[0][0];
    expect(uploadMocks.fetchSubmissionStatus).toHaveBeenCalledWith(submitted.submissionId);
  });

  it('submits an owner-selected accessory and color as an immutable request', async () => {
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    await prepareUploadFlow();
    fireEvent.click(screen.getByRole('button', { name: /더 닮게 꾸미기/ }));
    fireEvent.click(screen.getByRole('radio', { name: '리본핀' }));
    fireEvent.click(screen.getByRole('radio', { name: '하늘' }));
    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));

    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledWith(expect.objectContaining({
      accessorySelectionMode: 'owner',
      requestedAccessory: { kind: 'ribbon', color: 'sky', assetKey: 'builtin:ribbon' },
    })));
  });

  it('locks the selected photo and editor while submission is in flight', async () => {
    let resolveSubmission: ((result: SubmitPetResult) => void) | undefined;
    uploadMocks.submitPet.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSubmission = resolve;
    }));
    const onSubmitted = await prepareUploadFlow();

    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /사진 추가하기/ })).toBeDisabled());
    expect(screen.getByPlaceholderText('예: 보리')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();

    resolveSubmission?.(submittedResult);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(submittedResult));
  });

  it('locks editing and retries the exact frozen payload while the outcome is uncertain', async () => {
    let rejectInitialSubmission!: (error: Error) => void;
    const initialSubmission = new Promise<SubmitPetResult>((_resolve, reject) => {
      rejectInitialSubmission = reject;
    });
    uploadMocks.submitPet
      .mockReturnValueOnce(initialSubmission)
      .mockResolvedValueOnce(submittedResult);
    uploadMocks.fetchSubmissionStatus.mockResolvedValue({ found: false });
    const onSubmitted = await prepareUploadFlow();
    uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,SECOND']);
    uploadMocks.normalizeAndAnalyzePetImage.mockResolvedValueOnce({
      dataUri: 'data:image/jpeg;base64,SECOND_NORMALIZED', traits, brightness: 180,
    });
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '이 모습으로 소개하기' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));
    expect(uploadMocks.submitPet).toHaveBeenCalledOnce();
    await act(async () => {
      rejectInitialSubmission(new PetApiError('요청 결과를 아직 확인하지 못했어요.', 'REQUEST_TIMEOUT', 'unknown'));
      await initialSubmission.catch(() => undefined);
    });

    // TDS keeps its loader mounted briefly for the exit animation, so its
    // transient accessible name can be "등록 상태 확인하기 loading".
    const recovery = screen.getByRole('button', { name: /등록 상태 확인하기/ });
    expect(screen.getByRole('button', { name: /사진 추가하기/ })).toBeDisabled();
    expect(screen.getByPlaceholderText('예: 보리')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '1번 사진 삭제' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2번 사진 삭제' })).toBeDisabled();
    expect(screen.getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('같은 강아지가 두 번 등록되지는 않아요.');

    const frozenInput = uploadMocks.submitPet.mock.calls[0][0];
    expect(frozenInput.dataUris).toEqual([normalizedPhoto, 'data:image/jpeg;base64,SECOND_NORMALIZED']);
    await act(async () => {
      fireEvent.click(recovery);
    });

    expect(uploadMocks.submitPet).toHaveBeenCalledTimes(2);
    expect(uploadMocks.submitPet.mock.calls[1][0]).toEqual(frozenInput);
    expect(uploadMocks.fetchSubmissionStatus).toHaveBeenNthCalledWith(1, frozenInput.submissionId);
    expect(uploadMocks.fetchSubmissionStatus).toHaveBeenNthCalledWith(2, frozenInput.submissionId);
    expect(onSubmitted).toHaveBeenCalledWith(submittedResult);
  });
});

describe('UploadFlow multiple photos', () => {
  it('switches only the large preview when another thumbnail is selected, preserving the representative and submission order', async () => {
    await prepareUploadFlow();
    fireEvent.click(screen.getByRole('radio', { name: '쫑긋 귀' }));
    uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,SECOND']);
    uploadMocks.normalizeAndAnalyzePetImage.mockResolvedValueOnce({
      dataUri: 'data:image/jpeg;base64,SECOND_NORMALIZED',
      traits: { ...traits, baseColor: 'black' },
      brightness: 50,
    });
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    await waitFor(() => expect(screen.getAllByText('준비 완료')).toHaveLength(2));
    const firstThumbnail = screen.getByRole('button', { name: '1번 사진 크게 보기' });
    const secondThumbnail = screen.getByRole('button', { name: '2번 사진 크게 보기' });
    fireEvent.click(secondThumbnail);

    expect(secondThumbnail).toHaveAttribute('aria-pressed', 'true');
    expect(firstThumbnail).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('img', { name: '2번 강아지 사진 미리보기' })).toHaveAttribute('src', 'data:image/jpeg;base64,SECOND_NORMALIZED');
    expect(screen.getByText('2번 사진')).toBeInTheDocument();
    expect(within(firstThumbnail).getByText('대표')).toBeInTheDocument();
    expect(within(firstThumbnail).queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1번 사진 삭제' })).toHaveTextContent('삭제');
    expect(screen.getByRole('radio', { name: '쫑긋 귀' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: '기본 털색' })).getByRole('radio', { name: '흰색' })).toBeChecked();

    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));
    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledWith(expect.objectContaining({
      dataUris: [normalizedPhoto, 'data:image/jpeg;base64,SECOND_NORMALIZED'],
      name: '하늘',
      traits: expect.objectContaining({ earShape: 'upright', baseColor: 'white' }),
    })));
  });

  it('falls back to a remaining photo after deleting the photo shown in the large preview', async () => {
    await prepareUploadFlow();
    uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,SECOND']);
    uploadMocks.normalizeAndAnalyzePetImage.mockResolvedValueOnce({
      dataUri: 'data:image/jpeg;base64,SECOND_NORMALIZED', traits, brightness: 180,
    });
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    await waitFor(() => expect(screen.getAllByText('준비 완료')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '2번 사진 크게 보기' }));
    fireEvent.click(screen.getByRole('button', { name: '2번 사진 삭제' }));

    expect(screen.getByRole('img', { name: '대표 강아지 사진' })).toHaveAttribute('src', normalizedPhoto);
    expect(screen.getByRole('button', { name: '1번 사진 크게 보기' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('img', { name: '2번 강아지 사진 미리보기' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1번 사진 삭제' }));
    expect(screen.getByRole('button', { name: /강아지 사진 고르기/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '대표 강아지 사진' })).not.toBeInTheDocument();
  });

  it('normalizes each selected photo sequentially and submits one dog in photo order', async () => {
    let finishFirst!: (value: { dataUri: string; traits: PetTraitsV1; brightness: number }) => void;
    const sources = ['FIRST', 'SECOND', 'THIRD'].map((value) => `data:image/png;base64,${value}`);
    const normalized = ['FIRST', 'SECOND', 'THIRD'].map((value) => `data:image/jpeg;base64,${value}_NORMALIZED`);
    uploadMocks.pickPhotos.mockResolvedValueOnce(sources);
    uploadMocks.normalizeAndAnalyzePetImage
      .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ dataUri: normalized[1], traits: { ...traits, baseColor: 'black' }, brightness: 50 })
      .mockResolvedValueOnce({ dataUri: normalized[2], traits, brightness: 180 });
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    const onSubmitted = vi.fn();
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><UploadFlow onSubmitted={onSubmitted} /></TDSMobileAITProvider>);

    fireEvent.click(screen.getByRole('button', { name: /강아지 사진 고르기/ }));
    expect(await screen.findByText('사진 3/5')).toBeInTheDocument();
    expect(uploadMocks.pickPhotos).toHaveBeenCalledWith(5);
    expect(uploadMocks.normalizeAndAnalyzePetImage).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('대기 중')).toHaveLength(2);
    expect(screen.queryByRole('img', { name: '대표 강아지 사진' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('img[src^="data:image/png"]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '사진 추가하기' })).toBeDisabled();
    await act(async () => finishFirst({ dataUri: normalized[0], traits, brightness: 180 }));

    await waitFor(() => expect(screen.getAllByText('준비 완료')).toHaveLength(3));
    sources.forEach((source, index) => expect(uploadMocks.normalizeAndAnalyzePetImage).toHaveBeenNthCalledWith(index + 1, source));
    expect(screen.getByRole('img', { name: '대표 강아지 사진' })).toHaveAttribute('src', normalized[0]);
    expect(within(screen.getByRole('group', { name: '기본 털색' })).getByRole('radio', { name: '흰색' })).toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: '강아지 이름' }), { target: { value: '보리' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(submittedResult));
    expect(uploadMocks.submitPet).toHaveBeenCalledOnce();
    expect(uploadMocks.submitPet).toHaveBeenCalledWith(expect.objectContaining({ dataUris: normalized, name: '보리', traits }));
    expect(uploadMocks.submitPet.mock.calls[0][0]).not.toHaveProperty('dataUri');
  });

  it('adds and removes photos without resetting the name, chosen appearance, or accessories', async () => {
    await prepareUploadFlow();
    fireEvent.click(screen.getByRole('radio', { name: '쫑긋 귀' }));
    fireEvent.click(screen.getByRole('button', { name: /더 닮게 꾸미기/ }));
    fireEvent.click(screen.getByRole('radio', { name: /몽글한 털/ }));
    fireEvent.click(screen.getByRole('radio', { name: '리본핀' }));
    const extras = ['SECOND', 'THIRD'].map((value) => `data:image/jpeg;base64,${value}_NORMALIZED`);
    uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,SECOND', 'data:image/png;base64,THIRD']);
    uploadMocks.normalizeAndAnalyzePetImage
      .mockResolvedValueOnce({ dataUri: extras[0], traits: { ...traits, baseColor: 'black' }, brightness: 50 })
      .mockResolvedValueOnce({ dataUri: extras[1], traits: { ...traits, earShape: 'rounded' }, brightness: 180 });
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    await waitFor(() => expect(screen.getAllByText('준비 완료')).toHaveLength(3));
    expect(uploadMocks.pickPhotos).toHaveBeenLastCalledWith(4);
    fireEvent.click(screen.getByRole('button', { name: '1번 사진 삭제' }));

    expect(screen.getByText('사진 2/5')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '대표 강아지 사진' })).toHaveAttribute('src', extras[0]);
    expect(screen.getByRole('textbox', { name: '강아지 이름' })).toHaveValue('하늘');
    expect(screen.getByRole('radio', { name: '쫑긋 귀' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /몽글한 털/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: '리본핀' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: '기본 털색' })).getByRole('radio', { name: '흰색' })).toBeChecked();
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));
    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledWith(expect.objectContaining({
      dataUris: extras,
      name: '하늘',
      traits: expect.objectContaining({ earShape: 'upright', baseColor: 'white' }),
      style: expect.objectContaining({ furStyle: 'cloud' }),
      accessorySelectionMode: 'owner',
      requestedAccessory: expect.objectContaining({ kind: 'ribbon' }),
    })));
  });

  it('keeps every failed photo and blocks submission until retrying its original source succeeds', async () => {
    await prepareUploadFlow();
    uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,FAILED', 'data:image/png;base64,THIRD']);
    uploadMocks.normalizeAndAnalyzePetImage
      .mockRejectedValueOnce(new Error('사진 크기를 줄이지 못했어요.'))
      .mockResolvedValueOnce({ dataUri: 'data:image/jpeg;base64,THIRD_NORMALIZED', traits, brightness: 180 })
      .mockResolvedValueOnce({ dataUri: 'data:image/jpeg;base64,RETRIED_NORMALIZED', traits, brightness: 180 });
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));

    await waitFor(() => expect(screen.getAllByText('준비 완료')).toHaveLength(2));
    expect(screen.getByText('사진 3/5')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('2번 사진: 사진 크기를 줄이지 못했어요.');
    const submit = screen.getByRole('button', { name: '이 모습으로 소개하기' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(uploadMocks.submitPet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '2번 사진 다시 시도하기' }));

    await waitFor(() => expect(submit).toBeEnabled());
    expect(uploadMocks.normalizeAndAnalyzePetImage).toHaveBeenLastCalledWith('data:image/png;base64,FAILED');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    fireEvent.click(submit);
    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledWith(expect.objectContaining({
      dataUris: [normalizedPhoto, 'data:image/jpeg;base64,RETRIED_NORMALIZED', 'data:image/jpeg;base64,THIRD_NORMALIZED'],
    })));
  });

  it('caps the selection at five and rejects an oversized addition without discarding existing photos', async () => {
    await prepareUploadFlow();
    uploadMocks.pickPhotos.mockResolvedValueOnce(['TWO', 'THREE', 'FOUR', 'FIVE']);
    for (const value of ['TWO', 'THREE', 'FOUR', 'FIVE']) {
      uploadMocks.normalizeAndAnalyzePetImage.mockResolvedValueOnce({ dataUri: `data:image/jpeg;base64,${value}`, traits, brightness: 180 });
    }
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    await waitFor(() => expect(screen.getAllByText('준비 완료')).toHaveLength(5));
    expect(screen.getByText('사진 5/5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '사진 추가하기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    expect(uploadMocks.pickPhotos).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '3번 사진 삭제' }));
    expect(screen.getByRole('button', { name: '사진 추가하기' })).toBeEnabled();
    uploadMocks.pickPhotos.mockResolvedValueOnce(['SIX', 'SEVEN']);
    fireEvent.click(screen.getByRole('button', { name: '사진 추가하기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('최대 5장');
    expect(uploadMocks.pickPhotos).toHaveBeenLastCalledWith(1);
    expect(uploadMocks.normalizeAndAnalyzePetImage).toHaveBeenCalledTimes(5);
    expect(screen.getByText('사진 4/5')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '3번 강아지 사진' })).toHaveAttribute('src', 'data:image/jpeg;base64,FOUR');
  });

  it('does not open two pickers at once and preserves the draft when selection is cancelled', async () => {
    await prepareUploadFlow();
    let cancelSelection!: (value: string[]) => void;
    uploadMocks.pickPhotos.mockReturnValueOnce(new Promise((resolve) => { cancelSelection = resolve; }));
    const add = screen.getByRole('button', { name: '사진 추가하기' });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(uploadMocks.pickPhotos).toHaveBeenCalledTimes(2);
    expect(add).toBeDisabled();
    expect(screen.getByRole('button', { name: '이 모습으로 소개하기' })).toBeDisabled();
    await act(async () => cancelSelection([]));
    expect(add).toBeEnabled();
    expect(screen.getByText('사진 1/5')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '강아지 이름' })).toHaveValue('하늘');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('can remove a failed representative photo and initialize from the next prepared photo', async () => {
    uploadMocks.pickPhotos.mockResolvedValueOnce(['data:image/png;base64,FAILED', 'data:image/png;base64,SECOND']);
    uploadMocks.normalizeAndAnalyzePetImage
      .mockRejectedValueOnce(new Error('사진을 읽지 못했어요.'))
      .mockResolvedValueOnce({ dataUri: normalizedPhoto, traits, brightness: 180 });
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><UploadFlow onSubmitted={vi.fn()} /></TDSMobileAITProvider>);
    fireEvent.click(screen.getByRole('button', { name: /강아지 사진 고르기/ }));
    await screen.findByText('준비 완료');
    expect(screen.queryByRole('textbox', { name: '강아지 이름' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1번 사진 삭제' }));
    expect(screen.getByRole('textbox', { name: '강아지 이름' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '대표 강아지 사진' })).toHaveAttribute('src', normalizedPhoto);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('EarShapePicker', () => {
  it('shows only neutral ear-shape names for the two primary choices', () => {
    const { container } = render(<EarShapePicker traits={traits} value="floppy" onChange={() => undefined} />);

    const group = screen.getByRole('group', { name: '귀 모양' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: '포근한 귀' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: '쫑긋 귀' })).toBeInTheDocument();
    expect(within(group).queryByText(/구르미처럼|하늘처럼|구르미형|하늘형/)).not.toBeInTheDocument();
    expect(container.querySelectorAll('.ear-choice-preview [data-ear-shape]')).toHaveLength(2);
    expect(container.querySelector('[data-ear-shape="floppy"][data-ear-family="gureumi"]')).toBeInTheDocument();
    expect(container.querySelector('[data-ear-shape="upright"][data-ear-family="haneul"]')).toBeInTheDocument();
    expect(container.querySelector('.ear-choice-face')).not.toBeInTheDocument();
  });

  it('reveals the two derived ears and keeps them open after selection', () => {
    const onChange = vi.fn<(value: EarShape) => void>();
    render(<EarShapePicker traits={traits} value="floppy" onChange={onChange} />);

    const toggle = screen.getByRole('button', { name: /다른 귀 모양 보기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(screen.getAllByRole('radio')).toHaveLength(4);
    fireEvent.click(screen.getByRole('radio', { name: /작고 동그란 귀/ }));
    expect(onChange).toHaveBeenCalledWith('rounded');
    expect(screen.getByRole('button', { name: /다른 귀 모양 닫기/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('automatically opens derived ears for existing semi and rounded values', () => {
    const onChange = vi.fn<(value: EarShape) => void>();
    const { rerender } = render(<EarShapePicker traits={traits} value="upright" onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    rerender(<EarShapePicker traits={{ ...traits, earShape: 'semi' }} value="semi" onChange={onChange} />);
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /살짝 접힌 귀/ })).toBeChecked();
  });
});

describe('FaceMarkingPicker', () => {
  it('shows every marking with an actual face thumbnail and the renamed forehead point', () => {
    const onChange = vi.fn<(value: MarkingPattern) => void>();
    const { container } = render(<FaceMarkingPicker traits={traits} onChange={onChange} />);

    const group = screen.getByRole('group', { name: '얼굴 무늬' });
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    expect(container.querySelectorAll('.marking-choice-preview [data-head-markings]')).toHaveLength(5);
    fireEvent.click(within(group).getByRole('radio', { name: '이마 포인트' }));
    expect(onChange).toHaveBeenCalledWith('blaze');
    expect(screen.queryByText('이마 선')).not.toBeInTheDocument();
  });
});

describe('CoatColorPickers', () => {
  it('disables a matching point color while a face marking is selected', () => {
    const onBaseColorChange = vi.fn<(value: CoatColor) => void>();
    const onPointColorChange = vi.fn<(value: CoatColor) => void>();
    render(
      <CoatColorPickers
        traits={traits}
        onBaseColorChange={onBaseColorChange}
        onPointColorChange={onPointColorChange}
      />,
    );

    const baseGroup = screen.getByRole('group', { name: '기본 털색' });
    const pointGroup = screen.getByRole('group', { name: '포인트 털색' });
    expect(within(pointGroup).getByRole('radio', { name: '흰색' })).toBeDisabled();
    fireEvent.click(within(pointGroup).getByRole('radio', { name: '캐러멜' }));
    fireEvent.click(within(baseGroup).getByRole('radio', { name: '초콜릿' }));
    expect(onPointColorChange).toHaveBeenCalledWith('caramel');
    expect(onBaseColorChange).toHaveBeenCalledWith('chocolate');
  });

  it('does not allow a point coat to reuse the base color', () => {
    render(
      <CoatColorPickers
        traits={{ ...traits, secondaryColor: 'white', markingPattern: 'none' }}
        onBaseColorChange={() => undefined}
        onPointColorChange={() => undefined}
      />,
    );

    const pointGroup = screen.getByRole('group', { name: '포인트 털색' });
    expect(within(pointGroup).getByRole('radio', { name: '흰색' })).toBeDisabled();
    expect(within(pointGroup).getByRole('radio', { name: '흰색' })).toBeChecked();
  });
});

describe('coat mode and fur outline', () => {
  it('offers three actual avatar outlines', () => {
    const { container } = render(<FurStylePicker traits={traits} style={{ schemaVersion: 1, coatMode: 'point', furStyle: 'neat' }} onChange={() => undefined} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(container.querySelector('[data-fur-style="neat"]')).toBeInTheDocument();
    expect(container.querySelector('[data-fur-style="fluffy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-fur-style="cloud"]')).toBeInTheDocument();
  });

  it('offers point and single-color modes with point selected by default', () => {
    render(<CoatModePicker value="point" onChange={() => undefined} />);
    expect(screen.getByRole('radio', { name: /포인트가 있어요/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /한 가지 색이에요/ })).not.toBeChecked();
  });

  it('hides point controls for a solid coat and restores the previous point choices', async () => {
    await prepareUploadFlow();
    expect(screen.queryByRole('group', { name: '포인트 털색' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /더 닮게 꾸미기/ }));
    expect(screen.getByRole('group', { name: '포인트 털색' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '이마 포인트' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: /한 가지 색이에요/ }));
    expect(screen.queryByRole('group', { name: '포인트 털색' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '얼굴 무늬' })).not.toBeInTheDocument();

    const solidBase = screen.getByRole('group', { name: '기본 털색' });
    fireEvent.click(within(solidBase).getByRole('radio', { name: '검정' }));
    fireEvent.click(screen.getByRole('radio', { name: /포인트가 있어요/ }));
    expect(within(screen.getByRole('group', { name: '포인트 털색' })).getByRole('radio', { name: '크림' })).toBeChecked();
  });

  it('keeps optional details collapsed and delegates accessories by default', async () => {
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    await prepareUploadFlow();

    const toggle = screen.getByRole('button', { name: /더 닮게 꾸미기/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: '털 윤곽' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));
    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledWith(expect.objectContaining({
      accessorySelectionMode: 'reviewer',
      requestedAccessory: undefined,
    })));
  });
});
