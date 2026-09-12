import { act, fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';
import albumStyles from '../album.css?inline';
import appStyles from '../styles.css?inline';

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
  it('keeps close and primary actions outside the scrolling photo content', () => {
    const stylesheet = document.createElement('style');
    stylesheet.textContent = appStyles;
    document.head.append(stylesheet);
    const onClose = vi.fn();
    const onShare = vi.fn();
    const { container, unmount } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={{ ...pet, shareable: true }} photoUrl="/haneul.jpg" onClose={onClose} onUpload={() => undefined} onReport={() => undefined} onShare={onShare} /></TDSMobileAITProvider>);
    try {
      const content = container.querySelector('.photo-card-content')!;
      const footer = container.querySelector('.photo-card-actions')!;
      const main = container.querySelector('.photo-card-main')!;
      const secondary = container.querySelector<HTMLElement>('.photo-card-secondary-actions')!;
      expect(screen.queryByRole('button', { name: '돌아가기' })).toBeNull();
      const share = screen.getByRole('button', { name: '이 귀여움 같이 보기' });
      expect(content).toContainElement(screen.getByRole('img', { name: '하늘의 실제 모습' }));
      expect(content).not.toContainElement(screen.getByRole('button', { name: '사진 닫기' }));
      expect(footer).toContainElement(share);
      expect(main).toContainElement(screen.getByRole('img', { name: '하늘의 실제 모습' }));
      expect(main.nextElementSibling).toBe(secondary);
      expect(window.getComputedStyle(main).minHeight).toBe('100%');
      expect(secondary).toContainElement(screen.getByRole('button', { name: '우리 강아지도 소개하기' }));
      expect(secondary).toContainElement(screen.getByRole('button', { name: '이 사진 신고하기' }));
      expect(footer).not.toContainElement(secondary);
      expect(window.getComputedStyle(content).overflow).toBe('auto');
      expect(window.getComputedStyle(footer).flexShrink).toBe('0');
      fireEvent.click(share);
      expect(onShare).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
      expect(onClose).toHaveBeenCalledOnce();
    } finally {
      unmount();
      stylesheet.remove();
    }
  });

  it('preserves the original photo height instead of shrinking it to fit secondary links', () => {
    expect(appStyles).toMatch(/\.photo-frame\s*\{[^}]*height:min\(52dvh,430px\)/);
    expect(appStyles).toMatch(/\.photo-frame\s*\{[^}]*height:min\(43dvh,276px\)/);
    expect(appStyles).not.toContain('100dvh - 400px');
  });

  it.each([{ loading: true }, { loadError: '사진을 다시 불러와 주세요' }, { photoUrl: '/haneul.jpg' }])('keeps only the close action, without an empty footer, when sharing is unavailable', (state) => {
    const onClose = vi.fn();
    const { container } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} {...state} onClose={onClose} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.queryByRole('button', { name: '돌아가기' })).toBeNull();
    expect(container.querySelector('.photo-card-actions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '사진 닫기' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stacks the favorite button below the name and keeps its touch target', () => {
    const stylesheet = document.createElement('style');
    stylesheet.textContent = albumStyles;
    document.head.append(stylesheet);
    const { container, unmount } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} onFavoriteChange={() => undefined} /></TDSMobileAITProvider>);
    try {
      const heading = container.querySelector('.photo-meta-heading')!;
      const name = screen.getByRole('heading', { name: '하늘' });
      const favorite = screen.getByRole('button', { name: '또 보고 싶어요, 마음에 담기' });
      expect(name.nextElementSibling).toBe(favorite);
      expect(window.getComputedStyle(heading).flexDirection).toBe('column');
      expect(window.getComputedStyle(heading).alignItems).toBe('center');
      expect(window.getComputedStyle(favorite).minHeight).toBe('44px');
    } finally {
      unmount();
      stylesheet.remove();
    }
  });

  it('only changes a favorite through the explicit favorite button, never through a photo reaction', () => {
    const onFavoriteChange = vi.fn();
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} isFavorite={false} onFavoriteChange={onFavoriteChange} /></TDSMobileAITProvider>);
    fireEvent.pointerDown(screen.getByRole('button', { name: '하늘 사진에 하트 효과 보기' }));
    expect(onFavoriteChange).not.toHaveBeenCalled();
    const favorite = screen.getByRole('button', { name: '또 보고 싶어요, 마음에 담기' });
    expect(favorite).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(favorite);
    expect(onFavoriteChange).toHaveBeenCalledWith(true);
  });

  it('shows the selected favorite state and prevents another request while saving', () => {
    const onFavoriteChange = vi.fn();
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} isFavorite favoritePending onFavoriteChange={onFavoriteChange} /></TDSMobileAITProvider>);
    const favorite = screen.getByRole('button', { name: '마음에 담았어요, 마음에 담기 취소' });
    expect(favorite).toHaveAttribute('aria-pressed', 'true');
    expect(favorite).toBeDisabled();
    fireEvent.click(favorite);
    expect(onFavoriteChange).not.toHaveBeenCalled();
  });

  it('lets a viewer remove a saved heart with an explicit cancellation label', () => {
    const onFavoriteChange = vi.fn();
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} isFavorite onFavoriteChange={onFavoriteChange} /></TDSMobileAITProvider>);
    const favorite = screen.getByRole('button', { name: '마음에 담았어요, 마음에 담기 취소' });
    expect(favorite).toHaveTextContent('마음에 담았어요');
    fireEvent.click(favorite);
    expect(onFavoriteChange).toHaveBeenCalledWith(false);
  });

  it('allows paging collected photos without a separate paid-photo action', () => {
    const onNextPhoto = vi.fn();
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} photoPosition={{ index: 0, total: 2 }} onNextPhoto={onNextPhoto} /></TDSMobileAITProvider>);
    expect(screen.getByRole('button', { name: '이전 사진' })).toBeDisabled();
    expect(screen.getByText('사진 1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음 사진' }));
    expect(onNextPhoto).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '다른 사진 만나기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /마음에 담기/ })).not.toBeInTheDocument();
  });

  it('describes a completed collection without promoting another paid photo', () => {
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={{ ...pet, collection: { collectedCount: 3, totalCount: 3, collectedToday: true, canCollectToday: false } }} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.getByText('모은 사진 3/3')).toBeInTheDocument();
    expect(screen.getByText('모두 모았어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다른 사진 만나기' })).not.toBeInTheDocument();
  });

  it('shows collection progress and caption under the name while keeping only close in the header', () => {
    const { container } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={{ ...pet, collection: { collectedCount: 1, totalCount: 3, collectedToday: true, canCollectToday: false } }} photoCaption="햇살 아래서 꾸벅꾸벅" photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    expect(container.querySelector('.photo-card-header')).not.toHaveTextContent('하늘의 사진');
    expect(container.querySelector('.photo-caption-row')).toHaveTextContent('모은 사진 1/3·햇살 아래서 꾸벅꾸벅');
    expect(screen.getByText('다시 놀러 오면 다음 사진도 만나요')).toBeInTheDocument();
    expect(screen.queryByText('귀엽기만 해도, 오늘은 충분해요.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '사진 닫기' })).toBeInTheDocument();
  });

  it('omits the caption separator when a photo has no caption', () => {
    const { container } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={{ ...pet, collection: { collectedCount: 1, totalCount: 2, collectedToday: true, canCollectToday: false } }} photoCaption="   " photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    expect(container.querySelector('.photo-caption-row')).toHaveTextContent('모은 사진 1/2');
    expect(container.querySelector('.photo-caption-divider')).not.toBeInTheDocument();
  });

  it('shows only the caption for an owner photo without collection or paid-access wording', () => {
    const { container } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={{ ...pet, isMine: true, ownerPhotoAvailable: true, collection: { collectedCount: 1, totalCount: 3, collectedToday: true, canCollectToday: false } }} photoCaption="산책이 좋은 날" photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    expect(container.querySelector('.photo-caption-row')).toHaveTextContent('산책이 좋은 날');
    expect(screen.queryByText(/모은 사진/)).not.toBeInTheDocument();
    expect(container.querySelector('.photo-collection-hint')).not.toBeInTheDocument();
  });

  it('keeps the complete caption accessible when its visible line is ellipsized', () => {
    const caption = '햇살이 따뜻한 오후에 가장 좋아하는 공을 꼭 안고 쉬어요';
    render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoCaption={caption} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    expect(screen.getByText(caption)).toHaveAttribute('title', caption);
  });

  it('keeps default-size captions ellipsized and wraps at 200% text size without a viewport change', async () => {
    const stylesheet = document.createElement('style');
    stylesheet.textContent = albumStyles;
    document.head.append(stylesheet);
    const oldRootStyle = document.documentElement.getAttribute('style');
    const realComputedStyle = window.getComputedStyle.bind(window);
    let captionFontSize = 13;
    const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => (
      element.classList.contains('photo-caption-row')
        ? { fontSize: `${captionFontSize}px` } as CSSStyleDeclaration
        : realComputedStyle(element, pseudo)
    ));
    const caption = '햇살이 따뜻한 오후에 가장 좋아하는 공을 꼭 안고 쉬어요';
    const { container, unmount } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoCaption={caption} photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    try {
      const card = container.querySelector('.photo-card');
      const text = screen.getByText(caption);
      expect(card).not.toHaveAttribute('data-large-text');
      expect(realComputedStyle(text).whiteSpace).toBe('nowrap');
      expect(realComputedStyle(text).textOverflow).toBe('ellipsis');
      await act(async () => {
        captionFontSize = 26;
        document.documentElement.style.fontSize = '200%';
        await Promise.resolve();
      });
      expect(card).toHaveAttribute('data-large-text', 'true');
      expect(realComputedStyle(text).whiteSpace).toBe('normal');
      expect(realComputedStyle(text).overflowWrap).toBe('anywhere');
      expect(text).toHaveTextContent(caption);
      await act(async () => {
        captionFontSize = 13;
        document.documentElement.style.fontSize = '100%';
        await Promise.resolve();
      });
      expect(card).not.toHaveAttribute('data-large-text');
      expect(realComputedStyle(text).whiteSpace).toBe('nowrap');
    } finally {
      unmount();
      computedStyle.mockRestore();
      if (oldRootStyle === null) document.documentElement.removeAttribute('style');
      else document.documentElement.setAttribute('style', oldRootStyle);
      stylesheet.remove();
    }
  });

  it('remeasures native font changes through ResizeObserver and disconnects when the caption closes', () => {
    let notifyResize: (() => void) | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const realComputedStyle = window.getComputedStyle.bind(window);
    let captionFontSize = 13;
    const computedStyle = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => (
      element.classList.contains('photo-caption-row')
        ? { fontSize: `${captionFontSize}px` } as CSSStyleDeclaration
        : realComputedStyle(element, pseudo)
    ));
    const { container, unmount } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A"><RevealCard pet={pet} photoCaption="즐거운 산책" photoUrl="/haneul.jpg" onClose={() => undefined} onUpload={() => undefined} onReport={() => undefined} /></TDSMobileAITProvider>);
    try {
      expect(observe).toHaveBeenCalledWith(container.querySelector('.photo-caption-row'));
      act(() => { captionFontSize = 26; notifyResize?.(); });
      expect(container.querySelector('.photo-card')).toHaveAttribute('data-large-text', 'true');
      unmount();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      unmount();
      computedStyle.mockRestore();
      vi.unstubAllGlobals();
    }
  });

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
    const photo = screen.getByRole('button', { name: '하늘 사진에 하트 효과 보기' });
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
    fireEvent.keyDown(screen.getByRole('button', { name: '하늘 사진에 하트 효과 보기' }), { key: 'Enter' });
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
    expect(screen.queryByRole('button', { name: '하늘 사진에 하트 효과 보기' })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
      await Promise.resolve();
    });

    expect(onRetryPhoto).toHaveBeenCalledOnce();
    expect(screen.getByRole('img', { name: '하늘의 실제 모습' })).toBeInTheDocument();
  });
});
