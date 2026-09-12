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

describe('PlayScene completion', () => {
  it('shows a small ticket hint only when entering a new-photo encounter', () => {
    const { rerender } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} photoHint="새 사진을 만나면 티켓 1장을 써요" onFed={() => undefined} onSound={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.getByText('새 사진을 만나면 티켓 1장을 써요')).toHaveClass('play-photo-hint');
    rerender(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><PlayScene pet={pet} onFed={() => undefined} onSound={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.queryByText('새 사진을 만나면 티켓 1장을 써요')).not.toBeInTheDocument();
  });

  it('signals phase changes immediately and requests the photo after the final reaction exactly once in StrictMode', () => {
    vi.useFakeTimers();
    const onPettingStart = vi.fn();
    const onInteractionComplete = vi.fn();
    const onFed = vi.fn();
    render(
      <StrictMode>
        <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
          <PlayScene pet={pet} onPettingStart={onPettingStart} onInteractionComplete={onInteractionComplete} onFed={onFed} onSound={() => undefined} />
        </TDSMobileAITProvider>
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(949));
    expect(onPettingStart).not.toHaveBeenCalled();
    expect(onInteractionComplete).not.toHaveBeenCalled();
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onPettingStart).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    expect(onInteractionComplete).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    expect(onInteractionComplete).toHaveBeenCalledOnce();
    expect(onInteractionComplete).toHaveBeenCalledWith('keyboard');
    expect(onFed).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: '하늘 교감 완료' }), { key: 'Enter' });
    act(() => vi.advanceTimersByTime(449));
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(onPettingStart).toHaveBeenCalledOnce();
    expect(onInteractionComplete).toHaveBeenCalledOnce();
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
    const onInteractionComplete = vi.fn();
    const onFed = vi.fn();
    const { container } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onInteractionComplete={onInteractionComplete} onFed={onFed} onSound={() => undefined} />
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
    expect(onInteractionComplete).toHaveBeenCalledOnce();
    expect(onInteractionComplete).toHaveBeenCalledWith('stroke');
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(450));

    expect(onFed).toHaveBeenCalledOnce();
    expect(onFed).toHaveBeenCalledWith('stroke');
  });

  it('counts a short movement as one tap, restarts reactions, and ignores a cancelled pointer', () => {
    vi.useFakeTimers();
    const onInteractionComplete = vi.fn();
    const onFed = vi.fn();
    const { container } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onInteractionComplete={onInteractionComplete} onFed={onFed} onSound={() => undefined} />
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
    expect(onInteractionComplete).not.toHaveBeenCalled();
    firePointer(dog, 'pointerup', { pointerId: 23, clientX: 60, clientY: 60 });
    expect(onInteractionComplete).toHaveBeenCalledOnce();
    expect(onInteractionComplete).toHaveBeenCalledWith('tap');
    expect(onFed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(450));

    expect(onFed).toHaveBeenCalledOnce();
    expect(onFed).toHaveBeenCalledWith('tap');
  });

  it('cancels the petting-start signal when unmounted while eating', () => {
    vi.useFakeTimers();
    const onPettingStart = vi.fn();
    const onInteractionComplete = vi.fn();
    const onFed = vi.fn();
    const { unmount } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onPettingStart={onPettingStart} onInteractionComplete={onInteractionComplete} onFed={onFed} onSound={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(949));
    unmount();
    act(() => vi.advanceTimersByTime(1000));

    expect(onPettingStart).not.toHaveBeenCalled();
    expect(onInteractionComplete).not.toHaveBeenCalled();
    expect(onFed).not.toHaveBeenCalled();
  });

  it('keeps the immediate completion signal but cancels the photo callback when unmounted during the reaction', () => {
    vi.useFakeTimers();
    const onPettingStart = vi.fn();
    const onInteractionComplete = vi.fn();
    const onFed = vi.fn();
    const { unmount } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <PlayScene pet={pet} onPettingStart={onPettingStart} onInteractionComplete={onInteractionComplete} onFed={onFed} onSound={() => undefined} />
      </TDSMobileAITProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(950));
    for (let i = 0; i < 3; i++) fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: ' ' });
    expect(onInteractionComplete).toHaveBeenCalledOnce();
    expect(onInteractionComplete).toHaveBeenCalledWith('keyboard');
    unmount();
    act(() => vi.advanceTimersByTime(1000));

    expect(onPettingStart).toHaveBeenCalledOnce();
    expect(onInteractionComplete).toHaveBeenCalledOnce();
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
    act(() => vi.advanceTimersByTime(450));
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
