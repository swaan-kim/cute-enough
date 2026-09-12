import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_PETS } from '../data/samplePets';
import type { PetSummary } from '../types';

const hapticMocks = vi.hoisted(() => ({
  playHaptic: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/haptics', () => hapticMocks);

import { House } from './House';
import { absoluteHousePoint, chooseHouseRoamPoint, clampHousePoint, HOUSE_DROP_PAUSE_MS, normalizedHousePoint } from '../lib/housePositions';

function makePets(count: number): PetSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    ...SAMPLE_PETS[index % SAMPLE_PETS.length],
    id: `dog-${index + 1}`,
    name: `강아지${index + 1}`,
  }));
}

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
  it('keeps four daily dogs in unique anchors and the owner as the optional fifth dog', () => {
    const dailyPets = makePets(4);
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
    expect(dailyButtons).toHaveLength(4);
    expect(new Set(Array.from(dailyButtons, (button) => button.getAttribute('data-house-slot'))).size).toBe(4);
    expect(document.querySelector('[data-pet-kind="owner"]')).toHaveAttribute('data-house-slot', 'owner');
    expect(screen.getByText('내 강아지')).toBeInTheDocument();
    expect(screen.queryByLabelText('새 친구를 기다리는 빈자리')).not.toBeInTheDocument();
  });

  it('renders explicit empty anchors instead of cloning dogs when fewer than four are available', () => {
    render(<House dailyPets={makePets(2)} onSelect={() => undefined} onSound={() => undefined} />);
    expect(screen.getAllByLabelText('새 친구를 기다리는 빈자리')).toHaveLength(2);
  });

  it('keeps server slot numbers and leaves vacant middle anchors empty', () => {
    const [first, third, fourth] = makePets(3).map((pet, index) => ({
      ...pet,
      houseSlot: [1, 3, 4][index],
    }));

    render(<House dailyPets={[first, third, fourth]} onSelect={() => undefined} onSound={() => undefined} />);

    expect(screen.getByRole('button', { name: '강아지1 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-a');
    expect(screen.getByRole('button', { name: '강아지2 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-c');
    expect(screen.getByRole('button', { name: '강아지3 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-d');
    const emptySlots = screen.getAllByLabelText('새 친구를 기다리는 빈자리');
    expect(emptySlots).toHaveLength(1);
    expect(emptySlots[0]).toHaveClass('house-slot--daily-b');
  });

  it('keeps revisit and met data without adding badges beside public dog names', () => {
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
    expect(screen.queryByText('사진 보기')).not.toBeInTheDocument();
    expect(screen.queryByText('♥')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '강아지1 옮기기 또는 선택' })).toHaveAttribute('data-pet-state', 'revisit');
  });

  it('keeps a free drop position without swapping another dog’s initial slot', () => {
    const dailyPets = makePets(4);
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
    firePointer(first, 'pointermove', { pointerId: 1, clientX: 256, clientY: 228 });
    const droppedLeft = first.style.left;
    const droppedTop = first.style.top;
    firePointer(first, 'pointerup', { pointerId: 1, clientX: 256, clientY: 228 });

    expect(first).toHaveAttribute('data-house-slot', 'daily-a');
    expect(first.style.left).toBe(droppedLeft);
    expect(first.style.top).toBe(droppedTop);
    expect(first).toHaveClass('is-positioned');
    expect(screen.getByRole('button', { name: '강아지2 옮기기 또는 선택' })).toHaveAttribute('data-house-slot', 'daily-b');
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

describe('House idle motion', () => {
  it('keeps every daily and owner dog eligible for roaming', () => {
    const dailyPets = makePets(4);
    const ownerBonusPet = {
      ...makePets(1)[0],
      id: 'owner-pet',
      name: '내 강아지',
      isMine: true,
      ownerPinned: true,
    };

    render(
      <House
        dailyPets={dailyPets}
        ownerBonusPet={ownerBonusPet}
        onSelect={() => undefined}
        onSound={() => undefined}
      />,
    );

    const dogs = screen.getAllByRole('button', { name: /옮기기 또는 선택/ });
    expect(dogs).toHaveLength(5);
    expect(dogs.every((dog) => dog.classList.contains('is-idle-active'))).toBe(true);
  });
});

function setRoomLayout(room: HTMLElement, dogs: HTMLElement[], initial = { width: 320, height: 400 }) {
  const roomSize = { ...initial };
  const asRect = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) });
  vi.spyOn(room, 'getBoundingClientRect').mockImplementation(() => asRect(0, 0, roomSize.width, roomSize.height));
  dogs.forEach((dog, index) => {
    Object.defineProperties(dog, {
      setPointerCapture: { configurable: true, value: vi.fn() }, hasPointerCapture: { configurable: true, value: vi.fn(() => true) }, releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    vi.spyOn(dog, 'getBoundingClientRect').mockImplementation(() => asRect(Number.parseFloat(dog.style.left) || 30 + index * 120, Number.parseFloat(dog.style.top) || 40, 100, 118));
  });
  act(() => window.dispatchEvent(new Event('resize')));
  return roomSize;
}

describe('House free positioning', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('holds the exact lifted drop for 1.5 seconds, then slowly walks from it', () => {
    vi.useFakeTimers();
    const onPositionsChange = vi.fn();
    render(<House dailyPets={makePets(1)} onSelect={() => undefined} onSound={() => undefined} onPositionsChange={onPositionsChange} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: /옮기기 또는 선택/ });
    setRoomLayout(room, [dog]);
    const box = dog.getBoundingClientRect();
    firePointer(dog, 'pointerdown', { pointerId: 1, clientX: box.left + 30, clientY: box.top + 30 });
    firePointer(dog, 'pointermove', { pointerId: 1, clientX: 160, clientY: 200 });
    const dropped = { left: dog.style.left, top: dog.style.top };
    firePointer(dog, 'pointerup', { pointerId: 1, clientX: 160, clientY: 200 });
    expect(dog.style.left).toBe(dropped.left);
    expect(dog.style.top).toBe(dropped.top);
    expect(onPositionsChange).toHaveBeenLastCalledWith(expect.objectContaining({ 'dog-1': expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }) }));
    act(() => vi.advanceTimersByTime(HOUSE_DROP_PAUSE_MS - 1));
    expect(dog.style.left).toBe(dropped.left);
    expect(dog).not.toHaveClass('is-walking');
    act(() => vi.advanceTimersByTime(1));
    expect(dog).toHaveClass('is-walking');
    expect(Number.parseFloat(dog.style.transitionDuration)).toBeGreaterThanOrEqual(3_800);
    expect(dog.style.left).not.toBe(dropped.left);
  });

  it('keeps cancel at its last safe coordinate and includes the name tag in bounds', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(<House dailyPets={makePets(1)} onSelect={onSelect} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: /옮기기 또는 선택/ });
    setRoomLayout(room, [dog]);
    const box = dog.getBoundingClientRect();
    firePointer(dog, 'pointerdown', { pointerId: 1, clientX: box.left + 30, clientY: box.top + 30 });
    firePointer(dog, 'pointermove', { pointerId: 1, clientX: 700, clientY: 800 });
    expect(dog.style.left).toBe('212px');
    expect(dog.style.top).toBe('274px');
    firePointer(dog, 'pointercancel', { pointerId: 1, clientX: 0, clientY: 0 });
    expect(dog.style.left).toBe('212px');
    expect(dog.style.top).toBe('274px');
    fireEvent.click(dog);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('restores a saved owner location and clamps normalized positions on resize', () => {
    const owner = { ...makePets(1)[0], id: 'owner', name: '우유', isMine: true };
    render(<House dailyPets={[]} ownerBonusPet={owner} positions={{ owner: { x: 1, y: 1 } }} dateKey="2026-09-05" onSelect={() => undefined} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: /옮기기 또는 선택/ });
    const size = setRoomLayout(room, [dog]);
    expect(dog.style.left).toBe('212px');
    expect(dog.style.top).toBe('274px');
    size.width = 260; size.height = 340;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(dog.style.left).toBe('152px');
    expect(dog.style.top).toBe('214px');
    expect(screen.getByText('내 강아지')).toBeInTheDocument();
  });

  it('saves every visible position before a click selects a dog while its neighbours are walking', () => {
    vi.useFakeTimers();
    const onPositionsChange = vi.fn();
    const onSelect = vi.fn();
    render(<House dailyPets={makePets(2)} onSelect={onSelect} onSound={() => undefined} onPositionsChange={onPositionsChange} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dogs = screen.getAllByRole('button', { name: /옮기기 또는 선택/ });
    setRoomLayout(room, dogs);
    act(() => vi.advanceTimersByTime(HOUSE_DROP_PAUSE_MS + 240));
    dogs.forEach((dog, index) => {
      vi.mocked(dog.getBoundingClientRect).mockReturnValue({ x: 40 + index * 130, y: 90, left: 40 + index * 130, top: 90, width: 100, height: 118, right: 140 + index * 130, bottom: 208, toJSON: () => ({}) });
    });
    fireEvent.click(dogs[0]);
    const saved = onPositionsChange.mock.calls.at(-1)?.[0];
    expect(saved).toEqual({
      'dog-1': normalizedHousePoint({ left: 40, top: 90 }, { width: 320, height: 400 }, { width: 100, height: 118 }),
      'dog-2': normalizedHousePoint({ left: 170, top: 90 }, { width: 320, height: 400 }, { width: 100, height: 118 }),
    });
    expect(onPositionsChange.mock.invocationCallOrder.at(-1)).toBeLessThan(onSelect.mock.invocationCallOrder[0]);
    expect(dogs.every((dog) => !dog.classList.contains('is-walking'))).toBe(true);
  });

  it('resizes from a visible in-between animation position instead of its future target', () => {
    vi.useFakeTimers();
    render(<House dailyPets={makePets(1)} onSelect={() => undefined} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: /옮기기 또는 선택/ });
    const roomSize = setRoomLayout(room, [dog]);
    act(() => vi.advanceTimersByTime(HOUSE_DROP_PAUSE_MS));
    expect(dog).toHaveClass('is-walking');
    vi.mocked(dog.getBoundingClientRect).mockReturnValue({ x: 51, y: 101, left: 51, top: 101, width: 100, height: 118, right: 151, bottom: 219, toJSON: () => ({}) });
    roomSize.width = 280;
    act(() => window.dispatchEvent(new Event('resize')));
    expect(dog.style.left).toBe('51px');
    expect(dog.style.top).toBe('101px');
    expect(dog).not.toHaveClass('is-walking');
  });

  it('stops scheduled motion when hidden and resumes from the same location after return', () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    render(<House dailyPets={makePets(1)} onSelect={() => undefined} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: /옮기기 또는 선택/ });
    setRoomLayout(room, [dog]);
    const before = dog.style.left;
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(20_000));
    expect(dog.style.left).toBe(before);
    expect(dog).not.toHaveClass('is-walking');
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => vi.advanceTimersByTime(HOUSE_DROP_PAUSE_MS));
    expect(dog).toHaveClass('is-walking');
  });

  it('does not schedule automatic motion with reduced motion enabled', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    render(<House dailyPets={makePets(1)} onSelect={() => undefined} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: /옮기기 또는 선택/ });
    setRoomLayout(room, [dog]);
    const before = dog.style.left;
    act(() => vi.advanceTimersByTime(20_000));
    expect(dog.style.left).toBe(before);
    expect(dog).not.toHaveClass('is-walking');
  });
});

describe('House coordinate and roaming boundaries', () => {
  it('round-trips coordinates and handles a viewport smaller than the character', () => {
    const room = { width: 320, height: 400 };
    const size = { width: 100, height: 118 };
    const point = { left: 150, top: 190 };
    expect(absoluteHousePoint(normalizedHousePoint(point, room, size), room, size)).toEqual(point);
    expect(clampHousePoint({ left: -5, top: 600 }, room, size)).toEqual({ left: 8, top: 274 });
    expect(clampHousePoint(point, { width: 80, height: 80 }, size)).toEqual({ left: 0, top: 0 });
  });
  it('avoids a blocked direction and waits when every direction is occupied', () => {
    const origin = { left: 100, top: 100 };
    const room = { width: 400, height: 400 };
    const size = { width: 60, height: 70 };
    const desired = { left: 130, top: 100 };
    expect(chooseHouseRoamPoint(origin, desired, room, size, [{ left: 165, top: 100, ...size }])?.left).toBeLessThan(origin.left);
    expect(chooseHouseRoamPoint(origin, desired, room, size, [{ left: 0, top: 0, width: 400, height: 400 }])).toBeUndefined();
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
