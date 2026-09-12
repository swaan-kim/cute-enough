import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AlbumPetSummary } from '../types';
import { SAMPLE_PETS } from '../data/samplePets';

vi.mock('@toss/tds-mobile', () => {
  const TopRoot = ({ title, subtitleBottom }: { title?: ReactNode; subtitleBottom?: ReactNode }) => <header>{title}{subtitleBottom}</header>;
  return {
    Top: Object.assign(TopRoot, { TitleParagraph: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>, SubtitleParagraph: ({ children }: { children?: ReactNode }) => <p>{children}</p> }),
    Button: ({ children, display: _display, size: _size, color: _color, variant: _variant, loading: _loading, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode; display?: string; size?: string; color?: string; variant?: string; loading?: boolean }) => <button {...props}>{children}</button>,
  };
});
vi.mock('./PetArtwork', () => ({ PetArtwork: ({ pet }: { pet: AlbumPetSummary }) => <span data-testid="artwork">{pet.designVersion}</span> }));

import { AlbumScreen } from './AlbumScreen';

const pet: AlbumPetSummary = {
  id: 'haneul', name: '하늘', designVersion: 2, isFavorite: true, unlockedPhotoCount: 2,
  collection: { collectedCount: 2, totalCount: 5, collectedToday: true, canCollectToday: false },
  publishedDesign: { ...SAMPLE_PETS[0].publishedDesign!, designVersion: 2 }, designStatus: 'ready',
  traits: { schemaVersion: 1, earShape: 'upright', headShape: 'round', baseColor: 'cream', secondaryColor: 'white', markingPattern: 'none', muzzle: 'short', confidence: 1 },
  unlockedPhotos: [
    { photoId: 'photo-1', unlockedAt: '2026-09-05T00:00:00Z', source: 'legacy_gift' },
    { photoId: 'photo-2', unlockedAt: '2026-09-05T01:00:00Z', source: 'reveal' },
  ],
};
const defaults = { pets: [pet], loading: false, error: '', filter: 'all' as const, onFilterChange: vi.fn(), onOpen: vi.fn(), onMeet: vi.fn(), onRetry: vi.fn() };

describe('AlbumScreen', () => {
  it('opens the collected photos from a character card without requesting photo thumbnails', () => {
    const onOpen = vi.fn();
    const { container } = render(<AlbumScreen {...defaults} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: '하늘, 모은 사진 2장, 전체 사진 5장, 마음에 담은 친구 사진 보기' }));
    expect(screen.getByRole('heading', { name: '강아지 앨범' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '마음에 담은 친구' })).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalledWith(pet);
    expect(screen.getByTestId('artwork')).toHaveTextContent('2');
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('모은 사진 2/5장')).toBeInTheDocument();
    expect(screen.getByText('귀여움 차곡차곡')).toBeInTheDocument();
  });

  it('filters favorites without discarding other collected friends', () => {
    const secondPet = { ...pet, id: 'gureumi', name: '구르미', isFavorite: false };
    const onFilterChange = vi.fn();
    render(<AlbumScreen {...defaults} pets={[pet, secondPet]} filter="favorites" onFilterChange={onFilterChange} />);
    expect(screen.getByRole('button', { name: /하늘, 모은 사진/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /구르미, 모은 사진/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '모든 친구' }));
    expect(onFilterChange).toHaveBeenCalledWith('all');
  });

  it('routes an empty album back to the house', () => {
    const onMeet = vi.fn();
    render(<AlbumScreen {...defaults} pets={[]} onMeet={onMeet} />);
    expect(screen.getByText('친구를 만나면 사진이 여기에 모여요')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '친구 만나러 가기' }));
    expect(onMeet).toHaveBeenCalledOnce();
  });

  it('keeps existing friends visible on refresh failure and offers an in-place retry', () => {
    const onRetry = vi.fn();
    render(<AlbumScreen {...defaults} error="연결을 확인해 주세요" onRetry={onRetry} />);
    expect(screen.getByRole('button', { name: /하늘, 모은 사진/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('celebrates collecting every active photo and updates when more photos are approved', () => {
    const completePet = { ...pet, collection: { ...pet.collection!, totalCount: 2 } };
    const { rerender } = render(<AlbumScreen {...defaults} pets={[completePet]} />);
    expect(screen.getByText('모은 사진 2/2장')).toHaveClass('is-complete');
    expect(screen.getByText('귀여움 다 모았어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /전체 사진 2장, 모두 모았어요/ })).toBeInTheDocument();
    rerender(<AlbumScreen {...defaults} />);
    expect(screen.getByText('모은 사진 2/5장')).not.toHaveClass('is-complete');
    expect(screen.queryByText('귀여움 다 모았어요')).not.toBeInTheDocument();
  });

  it('uses the matching server collection counts after an old photo is withdrawn', () => {
    render(<AlbumScreen {...defaults} pets={[{ ...pet, collection: { ...pet.collection!, collectedCount: 1, totalCount: 3 } }]} />);
    expect(screen.getByText('모은 사진 1/3장')).toBeInTheDocument();
  });

  it('keeps legacy albums usable without making up a total from collected photos', () => {
    const legacyPet = { ...pet, collection: undefined, unlockedPhotoCount: undefined };
    const onOpen = vi.fn();
    render(<AlbumScreen {...defaults} pets={[legacyPet]} onOpen={onOpen} />);
    expect(screen.getByText('모은 사진 2장')).toBeInTheDocument();
    expect(screen.queryByText(/모은 사진 2\//)).not.toBeInTheDocument();
    expect(screen.queryByText('귀여움 다 모았어요')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '하늘, 모은 사진 2장, 마음에 담은 친구 사진 보기' }));
    expect(onOpen).toHaveBeenCalledWith(legacyPet);
  });

  it.each([
    { collectedCount: 3, totalCount: 2 }, { collectedCount: 2, totalCount: -1 },
    { collectedCount: 2, totalCount: Number.NaN }, { collectedCount: 2, totalCount: 2.5 },
  ])('avoids misleading totals from an invalid collection pair: %j', (counts) => {
    render(<AlbumScreen {...defaults} pets={[{ ...pet, collection: { ...pet.collection!, ...counts } }]} />);
    expect(screen.getByText('모은 사진 2장')).toBeInTheDocument();
    expect(screen.queryByText('귀여움 다 모았어요')).not.toBeInTheDocument();
  });

  it('does not celebrate an empty zero-photo state', () => {
    render(<AlbumScreen {...defaults} pets={[{ ...pet, collection: { ...pet.collection!, collectedCount: 0, totalCount: 0 } }]} />);
    expect(screen.getByText('모은 사진 0/0장')).toBeInTheDocument();
    expect(screen.queryByText('귀여움 다 모았어요')).not.toBeInTheDocument();
  });
});
