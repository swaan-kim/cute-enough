import { fireEvent, render, screen } from '@testing-library/react';
import { TDSMobileAITProvider } from '@toss/tds-mobile-ait';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PetSummary } from '../types';
import { SharedPetLanding } from './SharedPetLanding';

const traits = { schemaVersion: 1, earShape: 'floppy', headShape: 'round', baseColor: 'white', secondaryColor: 'cream', markingPattern: 'none', muzzle: 'short', confidence: 1 } as const;
const pet = (approvalStatus: PetSummary['approvalStatus'], revealedToday = false): PetSummary => ({
  id: 'shared-pet', name: '하늘', traits, approvalStatus, revealedToday,
  photoUrl: 'https://private.example/photo.jpg',
});
const renderLanding = (
  value: PetSummary,
  onMeet = () => undefined,
  accessDecision?: ComponentProps<typeof SharedPetLanding>['accessDecision'],
) => render(
  <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
    <SharedPetLanding pet={value} accessDecision={accessDecision} onMeet={onMeet} onHome={() => undefined} />
  </TDSMobileAITProvider>,
);

describe('SharedPetLanding', () => {
  it('shows only the character flow while a shared pet is pending', () => {
    const onMeet = vi.fn();
    renderLanding(pet('pending'), onMeet);
    expect(screen.getByText(/실제 사진은 승인 후 공개해요/)).toBeInTheDocument();
    expect(screen.getByText(/티켓은 사용하지 않아요/)).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: '간식 주고 만나기' })).toBeInTheDocument();
  });

  it('uses an owner-specific direct-photo action for the uploader', () => {
    renderLanding({ ...pet('approved'), isMine: true, ownerPhotoAvailable: true });
    expect(screen.getByRole('button', { name: '내 강아지 사진 보기' })).toBeInTheDocument();
  });

  it('lets the uploader open a pending photo without showing recipient-only copy', () => {
    renderLanding(
      { ...pet('pending'), isMine: true, ownerPhotoAvailable: true },
      () => undefined,
      { kind: 'ownerPhoto' },
    );
    expect(screen.getByRole('button', { name: '내 강아지 사진 보기' })).toBeInTheDocument();
    expect(screen.getByText(/사진은 올린 사람에게만 보여요/)).toBeInTheDocument();
    expect(screen.queryByText(/오늘은 캐릭터와만 놀아요/)).not.toBeInTheDocument();
  });

  it('labels free and rewarded access without surprising the recipient', () => {
    const { rerender } = renderLanding(pet('approved'), () => undefined, { kind: 'reveal', method: 'FREE' });
    expect(screen.getByRole('button', { name: '무료 티켓으로 만나기' })).toBeInTheDocument();

    rerender(
      <TDSMobileAITProvider brandPrimaryColor="#FF6B8A">
        <SharedPetLanding pet={pet('approved')} accessDecision={{ kind: 'reveal', method: 'REWARDED' }} onMeet={() => undefined} onHome={() => undefined} />
      </TDSMobileAITProvider>,
    );
    expect(screen.getByRole('button', { name: '광고 보고 지금 만나기' })).toBeInTheDocument();
  });

  it('disables the action while every access path is exhausted', () => {
    renderLanding(pet('approved'), () => undefined, { kind: 'exhausted' });
    expect(screen.getByRole('button', { name: '티켓 충전 중' })).toBeDisabled();
  });
});
