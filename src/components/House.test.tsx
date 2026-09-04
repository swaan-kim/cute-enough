import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import type { PetSummary } from '../types';

const hapticMocks = vi.hoisted(() => ({
  playHaptic: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/haptics', () => hapticMocks);

import { getNearestHouseSlot, House, HOUSE_DAILY_SLOTS } from './House';

function makePets(count: number): PetSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    ...SAMPLE_PETS[index % SAMPLE_PETS.length],
    id: `dog-${index + 1}`,
    name: `강아지${index + 1}`,
  }));
}

function firePointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
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

describe('House dog drag haptic', () => {
  beforeEach(() => {
    hapticMocks.playHaptic.mockClear();
  });

  it.each(SAMPLE_PETS)('$name also plays one weak cue only when movement crosses the drag threshold', (pet) => {
    const onSelect = vi.fn();
    render(<House pets={[pet]} onSelect={onSelect} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: `${pet.name} 옮기기 또는 선택` });
    Object.defineProperties(dog, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(room, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 420, width: 320, height: 420,
      toJSON: () => ({}),
    });
    vi.spyOn(dog, 'getBoundingClientRect').mockReturnValue({
      x: 30, y: 40, left: 30, top: 40, right: 144, bottom: 154, width: 114, height: 114,
      toJSON: () => ({}),
    });

    firePointer(dog, 'pointerdown', { button: 0, pointerId: 1, clientX: 50, clientY: 60 });
    firePointer(dog, 'pointermove', { pointerId: 1, clientX: 54, clientY: 60 });
    expect(hapticMocks.playHaptic).not.toHaveBeenCalled();

    firePointer(dog, 'pointermove', { pointerId: 1, clientX: 60, clientY: 60 });
    firePointer(dog, 'pointermove', { pointerId: 1, clientX: 90, clientY: 80 });
    expect(hapticMocks.playHaptic).toHaveBeenCalledTimes(1);
    expect(hapticMocks.playHaptic).toHaveBeenCalledWith('dragStart');

    firePointer(dog, 'pointerup', { pointerId: 1, clientX: 90, clientY: 80 });
    fireEvent.click(dog);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('House daily and owner slots', () => {
  it('keeps five daily dogs in unique anchors and the owner on the sofa spot', () => {
    const dailyPets = makePets(5);
    const ownerBonusPet = {
      ...SAMPLE_PETS[0],
      id: 'my-dog',
      name: '우유',
      isMine: true,
      ownerPinned: true,
      approvalStatus: 'pending' as const,
    };

    render(
      <House
        dailyPets={dailyPets}
        ownerBonusPet={ownerBonusPet}
        onSelect={() => undefined}
        onSound={() => undefined}
      />,
    );

    const dailyButtons = document.querySelectorAll('[data-pet-kind="daily"]');
    expect(dailyButtons).toHaveLength(5);
    expect(new Set(Array.from(dailyButtons, (button) => button.getAttribute('data-house-slot'))).size).toBe(5);
    expect(document.querySelector('[data-pet-kind="owner"]')).toHaveAttribute('data-house-slot', 'owner');
    expect(screen.getByText('내 강아지')).toBeInTheDocument();
    expect(screen.queryByLabelText('새 친구를 기다리는 빈자리')).not.toBeInTheDocument();
  });

  it('renders explicit empty anchors instead of cloning dogs when fewer than five are available', () => {
    render(<House dailyPets={makePets(2)} onSelect={() => undefined} onSound={() => undefined} />);
    expect(screen.getAllByLabelText('새 친구를 기다리는 빈자리')).toHaveLength(3);
  });

  it('keeps server slot numbers and leaves vacant middle anchors empty', () => {
    const [first, third, fifth] = makePets(3).map((pet, index) => ({
      ...pet,
      houseSlot: [1, 3, 5][index],
    }));

    render(<House dailyPets={[first, third, fifth]} onSelect={() => undefined} onSound={() => undefined} />);

    expect(screen.getByRole('button', { name: '강아지1 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-a');
    expect(screen.getByRole('button', { name: '강아지2 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-c');
    expect(screen.getByRole('button', { name: '강아지3 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-e');
    const emptySlots = screen.getAllByLabelText('새 친구를 기다리는 빈자리');
    expect(emptySlots.map((slot) => slot.className)).toEqual(expect.arrayContaining([
      expect.stringContaining('house-slot--daily-b'),
      expect.stringContaining('house-slot--daily-d'),
    ]));
  });

  it('shows revisit and met state beside the dog name', () => {
    const [revisit, met] = makePets(2);
    render(
      <House
        dailyPets={[
          { ...revisit, revisitUntil: '2099-01-01T00:00:00.000Z' },
          met,
        ]}
        metPetIds={[met.id]}
        onSelect={() => undefined}
        onSound={() => undefined}
      />,
    );
    expect(screen.getByText('사진 보기')).toBeInTheDocument();
    expect(screen.getByText('♥')).toBeInTheDocument();
  });

  it('swaps occupied anchors when a dog is dropped onto another dog', () => {
    const dailyPets = makePets(5);
    render(<House dailyPets={dailyPets} onSelect={() => undefined} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const first = screen.getByRole('button', { name: '강아지1 옮기기 또는 선택' });
    Object.defineProperties(first, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(room, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 320, bottom: 400, width: 320, height: 400,
      toJSON: () => ({}),
    });
    vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({
      x: 10, y: 176, left: 10, top: 176, right: 110, bottom: 276, width: 100, height: 100,
      toJSON: () => ({}),
    });

    firePointer(first, 'pointerdown', { pointerId: 1, clientX: 60, clientY: 226 });
    firePointer(first, 'pointermove', { pointerId: 1, clientX: 160, clientY: 224 });
    firePointer(first, 'pointerup', { pointerId: 1, clientX: 160, clientY: 224 });

    expect(first).toHaveAttribute('data-house-slot', 'daily-b');
    expect(screen.getByRole('button', { name: '강아지2 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-a');
  });
});

describe('House first-use hint', () => {
  afterEach(() => vi.useRealTimers());

  it('automatically dismisses the centered hint after three seconds', () => {
    vi.useFakeTimers();
    const onHintDismiss = vi.fn();
    render(
      <House
        dailyPets={makePets(1)}
        showFirstHint
        onHintDismiss={onHintDismiss}
        onSelect={() => undefined}
        onSound={() => undefined}
      />,
    );
    expect(screen.getByText('마음 가는 친구를 톡 눌러보세요')).toBeInTheDocument();
    expect(screen.getByText('끌어 옮길 수도 있어요')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.queryByText('마음 가는 친구를 톡 눌러보세요')).not.toBeInTheDocument();
    expect(onHintDismiss).toHaveBeenCalledOnce();
  });
});

describe('getNearestHouseSlot', () => {
  it('maps pointer coordinates to one of the five stable anchors', () => {
    expect(getNearestHouseSlot({ x: 160, y: 224 }, { width: 320, height: 400 })).toBe('daily-b');
    expect(getNearestHouseSlot({ x: 266, y: 344 }, { width: 320, height: 400 })).toBe('daily-e');
    expect(HOUSE_DAILY_SLOTS).toHaveLength(5);
  });
});

describe('House loading', () => {
  it('waits before showing the room loader, then offers retry for a long request', () => {
    vi.useFakeTimers();
    const onVisible = vi.fn();
    const onRetry = vi.fn();
    render(<House pets={[]} loading onLoadingVisible={onVisible} onRetry={onRetry} onSelect={() => undefined} onSound={() => undefined} />);

    const loadingStatus = screen.getByText('친구들이 놀러 오는 중이에요').closest('.house-loading');
    expect(loadingStatus).not.toHaveClass('is-visible');
    act(() => vi.advanceTimersByTime(300));
    expect(loadingStatus).toHaveClass('is-visible');
    expect(onVisible).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(2_700));
    expect(screen.getByText('친구들을 조금만 더 기다려 주세요')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(onRetry).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
