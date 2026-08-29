import { act, fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';

const hapticMocks = vi.hoisted(() => ({
  playHaptic: vi.fn(() => Promise.resolve()),
}));

vi.mock('../lib/haptics', () => hapticMocks);

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
beforeEach(() => hapticMocks.playHaptic.mockClear());

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
    fireEvent.pointerDown(photo, { clientX: 90, clientY: 70 });
    expect(hapticMocks.playHaptic).toHaveBeenCalledTimes(1);
    expect(hapticMocks.playHaptic).toHaveBeenCalledWith('photoHeart');

    act(() => vi.advanceTimersByTime(301));
    fireEvent.pointerDown(photo, { clientX: 100, clientY: 80 });
    expect(hapticMocks.playHaptic).toHaveBeenCalledTimes(2);

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

  it('plays success only after the real photo pixels finish loading', () => {
    render(
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

    expect(hapticMocks.playHaptic).not.toHaveBeenCalled();
    fireEvent.load(screen.getByRole('img', { name: '하늘의 실제 모습' }));
    expect(hapticMocks.playHaptic).toHaveBeenCalledOnce();
    expect(hapticMocks.playHaptic).toHaveBeenCalledWith('photoReveal');
  });

  it('offers a branded photo save without triggering the heart surface', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
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

    expect(container.querySelector('.photo-watermark-preview')).toHaveTextContent('하늘');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '사진 저장' }));
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('replaces a failed photo with an in-place retry without closing the card', async () => {
    const onRetryPhoto = vi.fn().mockResolvedValue(undefined);
    render(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <RevealCard
          pet={pet}
          photoUrl="/expired-haneul.jpg"
          onClose={() => undefined}
          onUpload={() => undefined}
          onReport={() => undefined}
          onRetryPhoto={onRetryPhoto}
        />
      </TDSMobileAITProvider>,
    );

    fireEvent.error(screen.getByRole('img', { name: '하늘의 실제 모습' }));
    expect(screen.getByText('사진을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '하늘 사진에 하트 보내기' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
      await Promise.resolve();
    });

    expect(onRetryPhoto).toHaveBeenCalledOnce();
    expect(screen.getByRole('img', { name: '하늘의 실제 모습' })).toBeInTheDocument();
  });
});
