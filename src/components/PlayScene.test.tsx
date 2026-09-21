import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';
import { SAMPLE_PETS } from '../data/samplePets';

const hapticMocks = vi.hoisted(() => ({
  playHaptic: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/haptics', () => hapticMocks);

import { PlayScene } from './PlayScene';

const pet: PetSummary = {
  ...SAMPLE_PETS[0],
  id: 'sample-haneul', name: '하늘', approvalStatus: 'approved',
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 },
};

function firePointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId: number; clientX: number; clientY: number; button?: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(event, 'pointerId', { value: init.pointerId });
  fireEvent(target, event);
}

afterEach(() => vi.useRealTimers());
beforeEach(() => hapticMocks.playHaptic.mockClear());

describe('PlayScene treat authorization', () => {
  function authorization() {
    let resolve!: (allowed: boolean) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  }

  function dropTreat(treat: HTMLElement, dog: HTMLElement) {
    Object.defineProperties(treat, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(dog, 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 20, left: 20, top: 20, right: 300, bottom: 300, width: 280, height: 280,
      toJSON: () => ({}),
    });
    firePointer(treat, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 20 });
    firePointer(treat, 'pointermove', { pointerId: 1, clientX: 120, clientY: 140 });
    firePointer(treat, 'pointerup', { pointerId: 1, clientX: 120, clientY: 140 });
  }

  it.each(['button', 'dog', 'keyboard', 'drag'])('waits for authorization before feeding through %s', async (input) => {
    vi.useFakeTimers();
    const gate = authorization();
    const onBeforeTreat = vi.fn(() => gate.promise);
    const onSound = vi.fn();
    const onFed = vi.fn();
    const onPhotoRequest = vi.fn();
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} onBeforeTreat={onBeforeTreat}
      onPhotoRequest={onPhotoRequest} onFed={onFed} onSound={onSound} /></TDSMobileAITProvider>);
    const action = screen.getByRole('button', { name: '광고 보고 간식 주기' });
    expect(action).toBeDisabled();
    expect(onBeforeTreat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    expect(screen.getByText('광고를 보고 고구마를 줄 수 있어요')).toBeInTheDocument();
    const dog = screen.getByRole('button', { name: '하늘에게 간식 주기' });
    if (input === 'button') fireEvent.click(action);
    else if (input === 'dog') fireEvent.click(dog);
    else if (input === 'keyboard') fireEvent.keyDown(dog, { key: 'Enter' });
    else dropTreat(screen.getByRole('button', { name: '고구마 간식, 선택됨' }), dog);
    expect(onBeforeTreat).toHaveBeenCalledOnce();
    expect(action).toBeDisabled();
    act(() => vi.advanceTimersByTime(950));
    expect(screen.queryByText('냠냠, 맛있게 먹는 중이에요')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /쓰다듬기/ })).not.toBeInTheDocument();
    expect(onSound).not.toHaveBeenCalledWith('eat');
    expect(hapticMocks.playHaptic).not.toHaveBeenCalled();
    expect(onPhotoRequest).not.toHaveBeenCalled();
    expect(onFed).not.toHaveBeenCalled();
    await act(async () => { gate.resolve(true); await gate.promise; });
    expect(screen.getByText('냠냠, 맛있게 먹는 중이에요')).toBeInTheDocument();
    expect(onSound.mock.calls.filter(([effect]) => effect === 'eat')).toHaveLength(1);
    expect(hapticMocks.playHaptic.mock.calls).toEqual([['treatSuccess']]);
    act(() => vi.advanceTimersByTime(950));
    expect(screen.getByRole('button', { name: '하늘 쓰다듬기, 0번 완료' })).toBeInTheDocument();
  });

  it.each(['cancel', 'error'])('keeps the selected treat and permits retry after %s', async (result) => {
    const gate = authorization();
    const onBeforeTreat = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(true);
    const onSound = vi.fn();
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} onBeforeTreat={onBeforeTreat}
      treatActionLabel="광고 확인하고 간식 주기" onFed={() => undefined} onSound={onSound} /></TDSMobileAITProvider>);
    fireEvent.click(screen.getByRole('button', { name: '고기 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '광고 확인하고 간식 주기' }));
    await act(async () => {
      if (result === 'cancel') gate.resolve(false); else gate.reject(new Error('광고 확인 실패'));
      await gate.promise.catch(() => undefined);
    });
    expect(screen.getByRole('button', { name: '고기 간식, 선택됨' })).toBeEnabled();
    expect(screen.queryByText('냠냠, 맛있게 먹는 중이에요')).not.toBeInTheDocument();
    expect(onSound).not.toHaveBeenCalledWith('eat');
    expect(hapticMocks.playHaptic).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '광고 확인하고 간식 주기' })); });
    expect(onBeforeTreat).toHaveBeenCalledTimes(2);
    expect(screen.getByText('냠냠, 맛있게 먹는 중이에요')).toBeInTheDocument();
  });

  it('ignores repeated inputs while authorization is pending', async () => {
    const gate = authorization();
    const onBeforeTreat = vi.fn(() => gate.promise);
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} onBeforeTreat={onBeforeTreat}
      onFed={() => undefined} onSound={() => undefined} /></TDSMobileAITProvider>);
    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    const dog = screen.getByRole('button', { name: '하늘에게 간식 주기' });
    fireEvent.click(dog);
    fireEvent.keyDown(dog, { key: 'Enter' });
    fireEvent.click(dog);
    fireEvent.click(screen.getByRole('button', { name: '광고 보고 간식 주기' }));
    dropTreat(screen.getByRole('button', { name: '고구마 간식, 선택됨' }), dog);
    expect(onBeforeTreat).toHaveBeenCalledOnce();
    await act(async () => { gate.resolve(true); await gate.promise; });
    expect(hapticMocks.playHaptic.mock.calls).toEqual([['treatSuccess']]);
  });

  it('keeps the share alternative inline and blocks giving while native sharing is pending', async () => {
    const onShareReward = vi.fn();
    const onBeforeTreat = vi.fn().mockResolvedValue(true);
    const scene = (sharePending: boolean) => <TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet}
      photoHint="티켓 0장 · 간식을 주면 광고가 열려요." treatError="광고를 준비하지 못했어요. 다시 눌러 주세요."
      onShareReward={onShareReward} sharePending={sharePending} onBeforeTreat={onBeforeTreat}
      onFed={() => undefined} onSound={() => undefined} /></TDSMobileAITProvider>;
    const { rerender } = render(scene(false));
    fireEvent.click(screen.getByRole('button', { name: '고기 간식' }));
    const dog = screen.getByRole('button', { name: '하늘에게 간식 주기' });
    expect(dog).toHaveAccessibleDescription('티켓 0장 · 간식을 주면 광고가 열려요.');
    expect(screen.getByText('광고를 준비하지 못했어요. 다시 눌러 주세요.')).toHaveAttribute('role', 'status');
    fireEvent.click(screen.getByRole('button', { name: '공유하고 티켓 받기' }));
    expect(onShareReward).toHaveBeenCalledOnce();
    expect(onBeforeTreat).not.toHaveBeenCalled();
    rerender(scene(true));
    expect(screen.getByRole('button', { name: '공유 결과 확인 중…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '광고 보고 간식 주기' })).toBeDisabled();
    fireEvent.click(dog);
    fireEvent.keyDown(dog, { key: 'Enter' });
    expect(onBeforeTreat).not.toHaveBeenCalled();
    rerender(scene(false));
    expect(screen.getByRole('button', { name: '고기 간식, 선택됨' })).toBeEnabled();
  });

  it('stops promising an ad after a ticket is confirmed but still checks authorization when giving', async () => {
    const onBeforeTreat = vi.fn().mockResolvedValue(true);
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} adRequired={false}
      onBeforeTreat={onBeforeTreat} treatActionLabel="간식 주기" onFed={() => undefined} onSound={() => undefined} /></TDSMobileAITProvider>);
    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    expect(screen.getByText('고구마를 끌어주거나 강아지를 톡 눌러주세요')).toBeInTheDocument();
    expect(screen.queryByText(/광고를 보고/)).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '간식 주기' })); });
    expect(onBeforeTreat).toHaveBeenCalledOnce();
    expect(screen.getByText('냠냠, 맛있게 먹는 중이에요')).toBeInTheDocument();
  });

  it.each(['unmount', 'different-pet'])('ignores late authorization after %s', async (change) => {
    vi.useFakeTimers();
    const gate = authorization();
    const onBeforeTreat = vi.fn(() => gate.promise);
    const onSound = vi.fn();
    const onFed = vi.fn();
    const scene = (currentPet: PetSummary) => <TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={currentPet}
      onBeforeTreat={onBeforeTreat} onFed={onFed} onSound={onSound} /></TDSMobileAITProvider>;
    const { unmount, rerender } = render(scene(pet));
    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '광고 보고 간식 주기' }));
    if (change === 'unmount') unmount(); else rerender(scene({ ...pet, id: 'different-pet', name: '다른 친구' }));
    await act(async () => { gate.resolve(true); await gate.promise; vi.advanceTimersByTime(950); });
    expect(onSound).not.toHaveBeenCalledWith('eat');
    expect(hapticMocks.playHaptic).not.toHaveBeenCalled();
    expect(onFed).not.toHaveBeenCalled();
    expect(screen.queryByText('냠냠, 맛있게 먹는 중이에요')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /쓰다듬기/ })).not.toBeInTheDocument();
  });
});

describe('PlayScene completion', () => {
  it('shows a small ticket hint only when entering a new-photo encounter', () => {
    const { rerender } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} photoHint="두 번째로 쓰다듬으면 티켓 1장으로 사진을 준비해요" onFed={() => undefined} onSound={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.getByText('두 번째로 쓰다듬으면 티켓 1장으로 사진을 준비해요')).toHaveClass('play-photo-hint');
    rerender(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} onFed={() => undefined} onSound={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.queryByText('두 번째로 쓰다듬으면 티켓 1장으로 사진을 준비해요')).not.toBeInTheDocument();
  });

  it('requests on the second input and opens only after 900 ms exactly once in StrictMode', () => {
    vi.useFakeTimers();
    const onPhotoRequest = vi.fn();
    const onFed = vi.fn();
    render(
      <StrictMode>
        <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
          <PlayScene pet={pet} onPhotoRequest={onPhotoRequest} onFed={onFed} onSound={() => undefined} />
        </TDSMobileAITProvider>
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(949));
    expect(onPhotoRequest).not.toHaveBeenCalled();
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    expect(onPhotoRequest).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    expect(onPhotoRequest).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    expect(onPhotoRequest).toHaveBeenCalledOnce();
    expect(onPhotoRequest).toHaveBeenCalledWith('keyboard');
    expect(onFed).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: '하늘 교감 완료' }), { key: 'Enter' });
    act(() => vi.advanceTimersByTime(899));
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(onPhotoRequest).toHaveBeenCalledOnce();
    expect(onFed).toHaveBeenCalledOnce();
    expect(onFed).toHaveBeenCalledWith('keyboard');
    expect(hapticMocks.playHaptic.mock.calls).toEqual([
      ['treatSuccess'],
      ['pet'],
      ['pet'],
      ['pet'],
    ]);
  });

  it('fills one heart per cumulative stroke and reports a stroke after three strokes', () => {
    vi.useFakeTimers();
    const onPhotoRequest = vi.fn();
    const onFed = vi.fn();
    const { container } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onPhotoRequest={onPhotoRequest} onFed={onFed} onSound={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(950));
    const dog = screen.getByRole('button', { name: /하늘 쓰다듬기/ });
    Object.defineProperties(dog, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });

    firePointer(dog, 'pointerdown', { pointerId: 11, clientX: 90, clientY: 90 });
    expect(container.querySelector('.petting-hand')).toBeNull();
    firePointer(dog, 'pointermove', { pointerId: 11, clientX: 132, clientY: 90 });
    firePointer(dog, 'pointermove', { pointerId: 11, clientX: 90, clientY: 90 });
    firePointer(dog, 'pointerup', { pointerId: 11, clientX: 90, clientY: 90 });
    expect(screen.getByLabelText('쓰다듬기 1/3')).toBeInTheDocument();
    expect(container.querySelector('.feed-zone')).toHaveClass('is-pet-reacting', 'pet-reaction-a');

    act(() => vi.advanceTimersByTime(449));
    expect(dog).toHaveClass('is-pet-reacting');
    act(() => vi.advanceTimersByTime(1));
    expect(dog).not.toHaveClass('is-pet-reacting');
    expect(onPhotoRequest).not.toHaveBeenCalled();

    firePointer(dog, 'pointerdown', { pointerId: 12, clientX: 80, clientY: 80 });
    firePointer(dog, 'pointermove', { pointerId: 12, clientX: 155, clientY: 80 });
    firePointer(dog, 'pointerup', { pointerId: 12, clientX: 155, clientY: 80 });
    expect(screen.getByLabelText('쓰다듬기 2/3')).toBeInTheDocument();
    expect(container.querySelector('.feed-zone')).toHaveClass('pet-reaction-b');

    firePointer(dog, 'pointerdown', { pointerId: 13, clientX: 70, clientY: 70 });
    firePointer(dog, 'pointermove', { pointerId: 13, clientX: 125, clientY: 125 });
    firePointer(dog, 'pointerup', { pointerId: 13, clientX: 125, clientY: 125 });
    expect(dog).toHaveAttribute('aria-label', '하늘 교감 완료');
    expect(screen.getByLabelText('쓰다듬기 3/3')).toBeInTheDocument();
    expect(onPhotoRequest).toHaveBeenCalledOnce();
    expect(onPhotoRequest).toHaveBeenCalledWith('stroke');
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(899));
    expect(dog).toHaveClass('is-pet-reacting');
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(onFed).toHaveBeenCalledOnce();
    expect(onFed).toHaveBeenCalledWith('stroke');
  });

  it('counts a short movement as one tap, restarts reactions, and ignores a cancelled pointer', () => {
    vi.useFakeTimers();
    const onPhotoRequest = vi.fn();
    const onFed = vi.fn();
    const { container } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onPhotoRequest={onPhotoRequest} onFed={onFed} onSound={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(950));
    const dog = screen.getByRole('button', { name: /하늘 쓰다듬기/ });
    Object.defineProperties(dog, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });

    firePointer(dog, 'pointerdown', { pointerId: 20, clientX: 60, clientY: 60 });
    firePointer(dog, 'pointermove', { pointerId: 20, clientX: 160, clientY: 60 });
    firePointer(dog, 'pointercancel', { pointerId: 20, clientX: 160, clientY: 60 });
    expect(screen.getByLabelText('쓰다듬기 0/3')).toBeInTheDocument();
    fireEvent.keyDown(dog, { key: 'Enter', repeat: true });
    expect(screen.getByLabelText('쓰다듬기 0/3')).toBeInTheDocument();

    firePointer(dog, 'pointerdown', { pointerId: 21, clientX: 60, clientY: 60 });
    fireEvent.keyDown(dog, { key: 'Enter' });
    firePointer(dog, 'pointerdown', { pointerId: 99, clientX: 60, clientY: 60 });
    firePointer(dog, 'pointerup', { pointerId: 99, clientX: 60, clientY: 60 });
    expect(screen.getByLabelText('쓰다듬기 0/3')).toBeInTheDocument();
    firePointer(dog, 'pointermove', { pointerId: 21, clientX: 86, clientY: 60 });
    firePointer(dog, 'pointerup', { pointerId: 21, clientX: 86, clientY: 60 });
    expect(screen.getByLabelText('쓰다듬기 1/3')).toBeInTheDocument();
    expect(container.querySelector('.feed-zone')).toHaveClass('pet-reaction-a');

    firePointer(dog, 'pointerdown', { pointerId: 22, clientX: 60, clientY: 60 });
    firePointer(dog, 'pointerup', { pointerId: 22, clientX: 60, clientY: 60 });
    expect(container.querySelector('.feed-zone')).toHaveClass('pet-reaction-b');

    firePointer(dog, 'pointerdown', { pointerId: 23, clientX: 60, clientY: 60 });
    expect(onPhotoRequest).toHaveBeenCalledOnce();
    firePointer(dog, 'pointerup', { pointerId: 23, clientX: 60, clientY: 60 });
    expect(onPhotoRequest).toHaveBeenCalledOnce();
    expect(onPhotoRequest).toHaveBeenCalledWith('tap');
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(900));

    expect(onFed).toHaveBeenCalledOnce();
    expect(onFed).toHaveBeenCalledWith('tap');
  });

  it('never completes when unmounted while eating', () => {
    vi.useFakeTimers();
    const onPhotoRequest = vi.fn();
    const onFed = vi.fn();
    const { unmount } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onPhotoRequest={onPhotoRequest} onFed={onFed} onSound={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(949));
    unmount();
    act(() => vi.advanceTimersByTime(1000));

    expect(onPhotoRequest).not.toHaveBeenCalled();
    expect(onFed).not.toHaveBeenCalled();
  });

  it('keeps the immediate completion signal but cancels the photo callback when unmounted during the reaction', () => {
    vi.useFakeTimers();
    const onPhotoRequest = vi.fn();
    const onFed = vi.fn();
    const { unmount } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onPhotoRequest={onPhotoRequest} onFed={onFed} onSound={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(950));
    for (let i = 0; i < 3; i++) fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: ' ' });
    expect(onPhotoRequest).toHaveBeenCalledOnce();
    expect(onPhotoRequest).toHaveBeenCalledWith('keyboard');
    unmount();
    act(() => vi.advanceTimersByTime(1000));

    expect(onPhotoRequest).toHaveBeenCalledOnce();
    expect(onFed).not.toHaveBeenCalled();
  });

  it('keeps published SVG geometry and animated feeding/petting completion together', () => {
    vi.useFakeTimers();
    const onFed = vi.fn();
    const { container } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={{ ...pet, id: 'saved-play' }} onFed={onFed} onSound={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.getByRole('button', { name: '고구마 간식' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    expect(container.querySelector('.pet-design-svg')).toHaveClass('is-eating', 'is-happy');
    expect(container.querySelector('.is-eating ~ .heart-pop')).toBeInTheDocument();
    expect(container.querySelector('.dog-tongue')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(950));
    for (let i=0; i<3; i++) fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    act(() => vi.advanceTimersByTime(900));
    expect(onFed).toHaveBeenCalledOnce();
    expect(container.querySelector('.pet-artwork-design')).toHaveAttribute('data-design-sha256', pet.publishedDesign!.sha256);
    expect(container.querySelector('.pet-design-svg img,.panting-tongue-point')).toBeNull();
  });

  it('vibrates only for a successful treat drop and once per recognized pet gesture', () => {
    vi.useFakeTimers();
    render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onFed={() => undefined} onSound={() => undefined} />
      </TDSMobileAITProvider>,
    );
    const treat = screen.getByRole('button', { name: '고구마 간식' });
    Object.defineProperties(treat, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    const dog = screen.getByRole('button', { name: '하늘' });
    vi.spyOn(dog, 'getBoundingClientRect').mockReturnValue({
      x: 20, y: 20, left: 20, top: 20, right: 300, bottom: 300, width: 280, height: 280,
      toJSON: () => ({}),
    });

    firePointer(treat, 'pointerdown', { pointerId: 1, clientX: 20, clientY: 20 });
    firePointer(treat, 'pointermove', { pointerId: 1, clientX: 420, clientY: 420 });
    firePointer(treat, 'pointerup', { pointerId: 1, clientX: 420, clientY: 420 });
    expect(hapticMocks.playHaptic).not.toHaveBeenCalled();

    firePointer(treat, 'pointerdown', { pointerId: 2, clientX: 20, clientY: 20 });
    firePointer(treat, 'pointermove', { pointerId: 2, clientX: 120, clientY: 140 });
    firePointer(treat, 'pointerup', { pointerId: 2, clientX: 120, clientY: 140 });
    expect(hapticMocks.playHaptic.mock.calls).toEqual([['treatSuccess']]);

    act(() => vi.advanceTimersByTime(950));
    const pettingDog = screen.getByRole('button', { name: /하늘 쓰다듬기/ });
    Object.defineProperties(pettingDog, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    firePointer(pettingDog, 'pointerdown', { pointerId: 3, clientX: 80, clientY: 80 });
    firePointer(pettingDog, 'pointermove', { pointerId: 3, clientX: 110, clientY: 80 });
    firePointer(pettingDog, 'pointermove', { pointerId: 3, clientX: 150, clientY: 80 });
    firePointer(pettingDog, 'pointerup', { pointerId: 3, clientX: 150, clientY: 80 });

    expect(hapticMocks.playHaptic.mock.calls).toEqual([
      ['treatSuccess'],
      ['pet'],
    ]);
  });
});
