import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';
import { PlayScene } from './PlayScene';

const pet: PetSummary = {
  id: 'sample-haneul', name: '하늘', approvalStatus: 'approved',
  traits: { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 },
};

afterEach(() => vi.useRealTimers());

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
  });
});
