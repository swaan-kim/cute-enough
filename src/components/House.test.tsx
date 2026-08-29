import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';

const hapticMocks = vi.hoisted(() => ({
  playHaptic: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/haptics', () => hapticMocks);

import { House } from './House';

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

const pet: PetSummary = {
  id: 'dog',
  name: '보리',
  approvalStatus: 'approved',
  traits: {
    schemaVersion: 1,
    earShape: 'floppy',
    headShape: 'round',
    baseColor: 'cream',
    secondaryColor: 'caramel',
    markingPattern: 'none',
    muzzle: 'short',
    confidence: 1,
  },
};

describe('House dog drag haptic', () => {
  beforeEach(() => {
    hapticMocks.playHaptic.mockClear();
  });

  it('plays one weak cue only when movement crosses the drag threshold', () => {
    const onSelect = vi.fn();
    render(<House pets={[pet]} onSelect={onSelect} onSound={() => undefined} />);
    const room = screen.getByRole('region', { name: '강아지들이 있는 집' });
    const dog = screen.getByRole('button', { name: '보리 옮기기 또는 선택' });
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
