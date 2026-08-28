import { fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import { describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';
import { SharedPetLanding } from './SharedPetLanding';

const traits = { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 } as const;
const pet = (approvalStatus: PetSummary['approvalStatus'], revealedToday = false): PetSummary => ({
  id: 'shared-pet', name: '하늘', traits, approvalStatus, revealedToday,
  photoUrl: 'https://private.example/photo.jpg',
});
const renderLanding = (value: PetSummary, onMeet = () => undefined) => render(
  <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
    <SharedPetLanding pet={value} onMeet={onMeet} onHome={() => undefined} />
  </TDSMobileAITProvider>,
);

describe('SharedPetLanding', () => {
  it('shows only the character flow while a shared pet is pending', () => {
    const onMeet = vi.fn();
    renderLanding(pet('pending'), onMeet);
    expect(screen.getByText(/실제 사진은 승인 후 공개해요/)).toBeInTheDocument();
    expect(screen.queryByAltText('하늘의 실제 모습')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '캐릭터와 놀아보기' }));
    expect(onMeet).toHaveBeenCalledOnce();
  });

  it('does not offer a second paid reveal while the revisit window is active', () => {
    renderLanding(pet('approved', true));
    expect(screen.getByText(/사진을 바로 다시 볼 수 있어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '사진 다시 보기' })).toBeInTheDocument();
  });

  it('does not treat an expired server window as a free revisit', () => {
    renderLanding({
      ...pet('approved', true),
      revisitUntil: '2020-01-01T00:00:00.000Z',
    });
    expect(screen.getByRole('button', { name: '이 친구 만나기' })).toBeInTheDocument();
  });
});
