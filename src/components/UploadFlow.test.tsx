import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoatColor, EarShape, MarkingPattern, PetTraitsV1, SubmitPetResult } from '../types';

const uploadMocks = vi.hoisted(() => ({
  pickOnePhoto: vi.fn<() => Promise<string | null>>(),
  pickOnePhotoFromBrowser: vi.fn<() => Promise<string | null>>(),
  normalizeAndAnalyzePetImage: vi.fn(),
  fetchSubmissionStatus: vi.fn(),
  submitPet: vi.fn(),
}));

vi.mock('../lib/toss', () => ({
  pickOnePhoto: uploadMocks.pickOnePhoto,
  pickOnePhotoFromBrowser: uploadMocks.pickOnePhotoFromBrowser,
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

import { CoatColorPickers, EarShapePicker, FaceMarkingPicker, UploadFlow } from './UploadFlow';
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
  uploadMocks.pickOnePhoto.mockReset();
  uploadMocks.pickOnePhotoFromBrowser.mockReset();
  uploadMocks.normalizeAndAnalyzePetImage.mockReset();
  uploadMocks.fetchSubmissionStatus.mockReset();
  uploadMocks.submitPet.mockReset();
});

async function prepareUploadFlow(onSubmitted = vi.fn()) {
  uploadMocks.pickOnePhoto.mockResolvedValueOnce('data:image/png;base64,SOURCE');
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

  fireEvent.click(screen.getByRole('button', { name: /사진 한 장 고르기/ }));
  fireEvent.click(await screen.findByRole('button', { name: '캐릭터 만들어보기' }));
  fireEvent.change(await screen.findByPlaceholderText('예: 보리'), { target: { value: '하늘' } });
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
    expect(screen.getByRole('button', { name: /사진 한 장 고르기/ })).toBeInTheDocument();
    expect(screen.getByText('내 집에 바로 나타나요')).toBeInTheDocument();
    expect(screen.getByText('승인 전 공유 링크에는 캐릭터만 보여요.')).toBeInTheDocument();
    expect(screen.getByText('승인되면 모두가 만나요')).toBeInTheDocument();
    expect(container.querySelectorAll('.upload-step-heading')).toHaveLength(1);
    expect(container.querySelectorAll('.upload-flow-guide > div > span')).toHaveLength(3);
    expect(container.querySelector('.upload-flow-guide')).not.toHaveTextContent('1내 집에 바로 나타나요');
  });

  it('turns the same photo button into a web picker retry when the Toss picker cannot open', async () => {
    uploadMocks.pickOnePhoto.mockRejectedValueOnce(Object.assign(
      new Error('토스 사진 선택창을 열지 못했어요. 한 번 더 눌러 기기 사진을 골라주세요.'),
      { useBrowserFallback: true },
    ));
    uploadMocks.pickOnePhotoFromBrowser.mockResolvedValueOnce('data:image/png;base64,FALLBACK');
    render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <UploadFlow onSubmitted={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /사진 한 장 고르기/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('한 번 더 눌러 기기 사진을 골라주세요.');

    fireEvent.click(screen.getByRole('button', { name: /기기에서 사진 고르기/ }));
    expect(uploadMocks.pickOnePhotoFromBrowser).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: '캐릭터 만들어보기' })).toBeInTheDocument();
  });

  it('carries the selected photo, name, confirmed traits, and consent through submission', async () => {
    uploadMocks.submitPet.mockResolvedValueOnce(submittedResult);
    const onSubmitted = vi.fn();
    await prepareUploadFlow(onSubmitted);
    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));

    await waitFor(() => expect(uploadMocks.submitPet).toHaveBeenCalledOnce());
    expect(uploadMocks.submitPet).toHaveBeenCalledWith({
      submissionId: expect.any(String),
      dataUri: normalizedPhoto,
      name: '하늘',
      traits,
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

  it('locks the selected photo and editor while submission is in flight', async () => {
    let resolveSubmission: ((result: SubmitPetResult) => void) | undefined;
    uploadMocks.submitPet.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSubmission = resolve;
    }));
    const onSubmitted = await prepareUploadFlow();

    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));

    await waitFor(() => expect(screen.getByRole('button', { name: /사진 바꾸기/ })).toBeDisabled());
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

    fireEvent.click(screen.getByRole('button', { name: '이 모습으로 소개하기' }));
    expect(uploadMocks.submitPet).toHaveBeenCalledOnce();
    await act(async () => {
      rejectInitialSubmission(new PetApiError('요청 결과를 아직 확인하지 못했어요.', 'REQUEST_TIMEOUT', 'unknown'));
      await initialSubmission.catch(() => undefined);
    });

    // TDS keeps its loader mounted briefly for the exit animation, so its
    // transient accessible name can be "등록 상태 확인하기 loading".
    const recovery = screen.getByRole('button', { name: /등록 상태 확인하기/ });
    expect(screen.getByRole('button', { name: /사진 바꾸기/ })).toBeDisabled();
    expect(screen.getByPlaceholderText('예: 보리')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getAllByRole('radio').every((radio) => (radio as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent('같은 강아지가 두 번 등록되지는 않아요.');

    const frozenInput = uploadMocks.submitPet.mock.calls[0][0];
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

describe('EarShapePicker', () => {
  it('starts with only the Gureumi and Haneul reference ears and uses real avatar previews', () => {
    const { container } = render(<EarShapePicker traits={traits} value="floppy" onChange={() => undefined} />);

    const group = screen.getByRole('group', { name: '귀 모양' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(within(group).getByRole('radio', { name: /포근한 귀 구르미처럼/ })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /쫑긋 귀 하늘처럼/ })).toBeInTheDocument();
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

  it('allows a single-color dog to use the same base and point color', () => {
    render(
      <CoatColorPickers
        traits={{ ...traits, secondaryColor: 'white', markingPattern: 'none' }}
        onBaseColorChange={() => undefined}
        onPointColorChange={() => undefined}
      />,
    );

    const pointGroup = screen.getByRole('group', { name: '포인트 털색' });
    expect(within(pointGroup).getByRole('radio', { name: '흰색' })).toBeEnabled();
    expect(within(pointGroup).getByRole('radio', { name: '흰색' })).toBeChecked();
  });
});
