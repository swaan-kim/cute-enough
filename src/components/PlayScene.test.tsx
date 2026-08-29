import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';

const hapticMocks = vi.hoisted(() => ({
  playHaptic: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/haptics', () => hapticMocks);

import { PlayScene } from './PlayScene';

const pet: PetSummary = {
  id: 'sample-haneul', name: '하늘', approvalStatus: 'approved',
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 },
};

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

afterEach(() => vi.useRealTimers());
beforeEach(() => hapticMocks.playHaptic.mockClear());

describe('PlayScene completion', () => {
  it('requests the photo exactly once after three pets in StrictMode', () => {
    vi.useFakeTimers();
    const onFed = vi.fn();
    render(
      <StrictMode>
        <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
          <PlayScene pet={pet} onFed={onFed} onSound={() => undefined} />
        </TDSMobileAITProvider>
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: '고구마 간식' }));
    fireEvent.click(screen.getByRole('button', { name: '하늘에게 간식 주기' }));
    act(() => vi.advanceTimersByTime(950));
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: /하늘 쓰다듬기/ }), { key: 'Enter' });
    act(() => vi.advanceTimersByTime(450));

    expect(onFed).toHaveBeenCalledOnce();
    expect(hapticMocks.playHaptic.mock.calls).toEqual([
      ['treatSuccess'],
      ['pet'],
      ['pet'],
      ['pet'],
    ]);
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
