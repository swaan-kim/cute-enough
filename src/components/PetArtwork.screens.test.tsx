import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { House } from './House';
import { PlayScene } from './PlayScene';
import { SharedPetLanding } from './SharedPetLanding';
import { MyPetsScreen } from './MyPetsScreen';
import { AlbumScreen } from './AlbumScreen';
import { SAMPLE_PETS } from '../data/samplePets';
const noop = () => {};
const pet = { ...SAMPLE_PETS[0], id: 'saved-all-screens', approvalStatus: 'approved' as const };

describe('reviewed SVG across app surfaces', () => {
  it.each([
    ['집', <House pets={[pet]} onSelect={noop} onSound={noop} />],
    ['교감', <PlayScene pet={pet} onFed={noop} onSound={noop} />],
    ['공유', <SharedPetLanding pet={pet} onMeet={noop} onHome={noop} />],
    ['내 강아지', <MyPetsScreen pets={[pet]} loading={false} error="" onMeet={noop} onShare={noop} onUpload={noop} onRetry={noop} />],
    ['앨범', <AlbumScreen pets={[{ ...pet, unlockedPhotos: [] }]} filter="all" loading={false} error="" onFilterChange={noop} onOpen={noop} onMeet={noop} onRetry={noop} />],
  ])('%s keeps the same published geometry and motion slots', (_, screen) => {
    const { container } = render(<TDSMobileAITProvider brandPrimaryColor="#FF6B8A">{screen}</TDSMobileAITProvider>);
    expect(container.querySelector('.pet-artwork-design')).toHaveAttribute('data-design-sha256', pet.publishedDesign!.sha256);
    expect(container.querySelector('.pet-design-svg svg')).toHaveAttribute('viewBox', '0 0 180 156');
    expect(container.querySelector('[data-pet-signature="peach-hairpin"]')).toBeInTheDocument();
    expect(container.querySelector('.dog-tail')).toBeInTheDocument();
    expect(container.querySelector('.dog-tongue')).toBeInTheDocument();
    expect(container.querySelector('.pet-artwork-design img,.panting-tongue-point')).toBeNull();
    expect(container.querySelector('button button')).toBeNull();
  });
});
