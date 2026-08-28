import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { OwnedPetSummary, PetTraitsV1 } from '../types';

vi.mock('@toss/tds-mobile', () => {
  const TopRoot = ({ title, subtitleBottom }: { title?: ReactNode; subtitleBottom?: ReactNode }) => <header>{title}{subtitleBottom}</header>;
  const Top = Object.assign(TopRoot, {
    TitleParagraph: ({ children }: { children?: ReactNode }) => <h1>{children}</h1>,
    SubtitleParagraph: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  });
  return {
    Top,
    Button: ({ children, display: _display, size: _size, color: _color, variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode; display?: string; size?: string; color?: string; variant?: string }) => <button {...props}>{children}</button>,
  };
});

import { MyPetsScreen } from './MyPetsScreen';

const traits: PetTraitsV1 = {
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'white',
  secondaryColor: 'caramel',
  markingPattern: 'brow',
  muzzle: 'short',
  confidence: 1,
};

const pendingPet: OwnedPetSummary = {
  id: 'pending-pet',
  name: '솜사탕',
  traits,
  approvalStatus: 'pending',
  ownerPhotoAvailable: true,
};

describe('MyPetsScreen', () => {
  it('offers the owner a direct photo action and character-only sharing while review is pending', () => {
    const onMeet = vi.fn();
    const onShare = vi.fn();
    render(
      <MyPetsScreen
        pets={[pendingPet]}
        loading={false}
        error=""
        onRetry={() => undefined}
        onUpload={() => undefined}
        onMeet={onMeet}
        onShare={onShare}
      />,
    );

    expect(screen.getByText('검수 중')).toBeInTheDocument();
    expect(screen.getByText(/사진은 나만 볼 수 있어요/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '사진 바로 보기' }));
    fireEvent.click(screen.getByRole('button', { name: '캐릭터 같이 보기' }));
    expect(onMeet).toHaveBeenCalledWith(pendingPet);
    expect(onShare).toHaveBeenCalledWith(pendingPet);
  });

  it('uses the approved sharing copy after review', () => {
    render(
      <MyPetsScreen
        pets={[{ ...pendingPet, approvalStatus: 'approved' }]}
        loading={false}
        error=""
        onRetry={() => undefined}
        onUpload={() => undefined}
        onMeet={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(screen.getByText(/다른 사람도 만날 수 있어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이 귀여움 같이 보기' })).toBeInTheDocument();
  });

  it('첫 등록 보너스는 실제 간식 흐름에 맞는 문구로 안내한다', () => {
    render(
      <MyPetsScreen
        pets={[pendingPet]}
        loading={false}
        error=""
        uploadRewardPetId={pendingPet.id}
        onRetry={() => undefined}
        onUpload={() => undefined}
        onMeet={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: '간식 주고 사진 보기' })).toBeInTheDocument();
  });

  it('서버가 원본 사진을 확인하지 못한 경우 사진과 공유 버튼을 막는다', () => {
    render(
      <MyPetsScreen
        pets={[{ ...pendingPet, ownerPhotoAvailable: false }]}
        loading={false}
        error=""
        onRetry={() => undefined}
        onUpload={() => undefined}
        onMeet={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: '사진 확인 중' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '캐릭터 같이 보기' })).toBeDisabled();
  });
});
