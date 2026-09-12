import { Button, Top } from '@toss/tds-mobile';
import type { AlbumPetSummary } from '../types';
import { PetArtwork } from './PetArtwork';
import { PetArtworkButton } from './PetArtworkButton';
import '../album.css';

export type AlbumFilter = 'all' | 'favorites';

type AlbumScreenProps = {
  pets: AlbumPetSummary[];
  loading: boolean;
  error: string;
  filter: AlbumFilter;
  onFilterChange: (filter: AlbumFilter) => void;
  onOpen: (pet: AlbumPetSummary) => void;
  onMeet: () => void;
  onRetry: () => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  hasMore?: boolean;
};

function photoProgress(pet: AlbumPetSummary) {
  const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
  const collection = pet.collection;
  // Use the server's matching pair: inactive/withdrawn photos may have changed
  // since the older unlocked-photo summary was cached. Never guess the total.
  if (validCount(collection?.collectedCount) && validCount(collection?.totalCount)
    && collection.collectedCount <= collection.totalCount) {
    return { collected: collection.collectedCount, total: collection.totalCount };
  }
  return { collected: validCount(pet.unlockedPhotoCount) ? pet.unlockedPhotoCount : pet.unlockedPhotos.length, total: undefined };
}

export function AlbumScreen({ pets, loading, error, filter, onFilterChange, onOpen, onMeet, onRetry, onLoadMore, loadingMore = false, hasMore = false }: AlbumScreenProps) {
  const visiblePets = filter === 'favorites' ? pets.filter((pet) => pet.isFavorite) : pets;
  return (
    <main className="album-screen">
      <Top
        upperGap={18}
        lowerGap={16}
        title={<Top.TitleParagraph size={28}>강아지 앨범</Top.TitleParagraph>}
        subtitleBottom={<Top.SubtitleParagraph>한 번 만난 귀여움은 언제든 다시 꺼내봐요.</Top.SubtitleParagraph>}
      />
      <div className="album-filters" role="group" aria-label="앨범 친구 보기">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => onFilterChange('all')}>모든 친구</button>
        <button type="button" aria-pressed={filter === 'favorites'} onClick={() => onFilterChange('favorites')}>마음에 담은 친구</button>
      </div>
      {loading && pets.length === 0 ? (
        <div className="album-message" role="status"><span aria-hidden="true">♡</span><p>만난 친구들을 모으고 있어요</p></div>
      ) : error && pets.length === 0 ? (
        <div className="album-message" role="status"><strong>앨범을 불러오지 못했어요</strong><p>{error}</p><Button size="medium" color="dark" variant="weak" onClick={onRetry}>다시 불러오기</Button></div>
      ) : <>
        {error && <div className="album-refresh-error" role="status"><p>{error}</p><Button size="small" color="dark" variant="weak" onClick={onRetry}>다시 불러오기</Button></div>}
        {visiblePets.length === 0 ? (
          <div className="album-message">
            <span aria-hidden="true">♡</span>
            <strong>{filter === 'favorites' ? '또 보고 싶은 친구를 마음에 담아요' : '친구를 만나면 사진이 여기에 모여요'}</strong>
            <p>{filter === 'favorites' ? '사진에서 ♡ 또 보고 싶어요를 눌러보세요.' : '처음 만난 사진부터 차곡차곡 담아둘게요.'}</p>
            <Button size="medium" onClick={filter === 'favorites' && pets.length > 0 ? () => onFilterChange('all') : onMeet}>{filter === 'favorites' && pets.length > 0 ? '모든 친구 보기' : '친구 만나러 가기'}</Button>
          </div>
        ) : <section className="album-grid" aria-label={filter === 'favorites' ? '마음에 담은 친구 목록' : '만난 친구 목록'}>
          {visiblePets.map((pet) => {
            const { collected, total } = photoProgress(pet);
            const complete = total !== undefined && total > 0 && collected === total;
            return <PetArtworkButton pet={pet} className="album-pet" type="button" key={`${pet.id}-${pet.designVersion ?? 1}`} onClick={() => onOpen(pet)} aria-label={`${pet.name ?? '이름 없는 귀요미'}, 모은 사진 ${collected}장${total === undefined ? '' : `, 전체 사진 ${total}장`}${complete ? ', 모두 모았어요' : ''}${pet.isFavorite ? ', 마음에 담은 친구' : ''} 사진 보기`}>
              <span className="album-pet-artwork"><PetArtwork pet={pet} size={114} retryControl={false} /></span>
              <strong>{pet.name ?? '이름 없는 귀요미'}</strong>
              <span className={`album-pet-count${complete ? ' is-complete' : ''}`}>모은 사진 {collected}{total === undefined ? '' : `/${total}`}장</span>
              <span className="album-pet-collection-copy">{complete ? '귀여움 다 모았어요' : '귀여움 차곡차곡'} <span aria-hidden="true">🐾</span></span>
              {pet.isFavorite && <span className="album-pet-favorite"><span aria-hidden="true">♥</span> 마음에 담은 친구</span>}
            </PetArtworkButton>;
          })}
        </section>}
        {hasMore && onLoadMore && <div className="album-load-more"><Button display="full" size="medium" color="dark" variant="weak" loading={loadingMore} disabled={loadingMore} onClick={onLoadMore}>친구 더 보기</Button></div>}
      </>}
    </main>
  );
}
