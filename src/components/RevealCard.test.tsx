import { act, fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';
import { RevealCard } from './RevealCard';

const pet: PetSummary = {
  id: 'haneul',
  name: '하늘',
  traits: {
    schemaVersion: 1,
    earShape: 'upright',
    headShape: 'oval',
    baseColor: 'cream',
    secondaryColor: 'white',
    markingPattern: 'blaze',
    muzzle: 'short',
    confidence: 1,
  },
};

afterEach(() => vi.useRealTimers());

describe('RevealCard', () => {
  it('shows one subtle heart where the user touches the photo', () => {
    vi.useFakeTimers();
    const { container } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <RevealCard
          pet={pet}
          photoUrl="/haneul.jpg"
          onClose={() => undefined}
          onUpload={() => undefined}
          onReport={() => undefined}
        />
      </TDSMobileAITProvider>,
    );
    const photo = screen.getByRole('button', { name: '하늘 사진에 하트 보내기' });
    vi.spyOn(photo, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(photo, { clientX: 80, clientY: 60 });
    expect(container.querySelector('.photo-tap-heart')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(901));
    expect(container.querySelector('.photo-tap-heart')).not.toBeInTheDocument();
  });

  it('also supports a keyboard heart reaction', () => {
    const { container } = render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <RevealCard
          pet={pet}
          photoUrl="/haneul.jpg"
          onClose={() => undefined}
          onUpload={() => undefined}
          onReport={() => undefined}
        />
      </TDSMobileAITProvider>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: '하늘 사진에 하트 보내기' }), { key: 'Enter' });
    expect(container.querySelector('.photo-tap-heart')).toBeInTheDocument();
  });

  it('offers a branded photo save without triggering the heart surface', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <RevealCard
          pet={pet}
          photoUrl="/haneul.jpg"
          onClose={() => undefined}
          onUpload={() => undefined}
          onReport={() => undefined}
          onSave={onSave}
        />
      </TDSMobileAITProvider>,
    );

    expect(screen.getByText('찰딱')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '사진 저장' }));
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
