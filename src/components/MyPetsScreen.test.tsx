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
        pets={[{ ...pendingPet, approvalStatus: 'approved', favoriteCount: 3 }]}
        loading={false}
        error=""
        onRetry={() => undefined}
        onUpload={() => undefined}
        onMeet={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(screen.getByText(/모두가 만날 수 있어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이 귀여움 같이 보기' })).toBeInTheDocument();
    expect(screen.getByText('♡ 마음에 담은 사람 3명')).toBeInTheDocument();
  });

  it('소유자 사진 권한이 있으면 기존 등록 보너스보다 바로 보기를 우선한다', () => {
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

    expect(screen.getByRole('button', { name: '사진 바로 보기' })).toBeInTheDocument();
  });

  it('서버가 원본 사진을 확인하지 못해도 pending 캐릭터 공유는 열어둔다', () => {
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
    expect(screen.getByRole('button', { name: '캐릭터 같이 보기' })).toBeEnabled();
  });

  it('반려 사유와 다시 소개하기 행동을 함께 보여준다', () => {
    const onUpload = vi.fn();
    render(
      <MyPetsScreen
        pets={[{ ...pendingPet, approvalStatus: 'rejected', rejectionReason: '얼굴이 잘 보이는 사진이 필요해요.' }]}
        loading={false}
        error=""
        onRetry={() => undefined}
        onUpload={onUpload}
        onMeet={() => undefined}
        onShare={() => undefined}
      />,
    );

    expect(screen.getByText('등록하지 못했어요')).toBeInTheDocument();
    expect(screen.getByText(/반려 사유 · 얼굴이 잘 보이는/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다른 사진으로 다시 소개하기' }));
    expect(onUpload).toHaveBeenCalledOnce();
  });

  it.each(['pending', 'approved'] as const)('%s 강아지에 사진 추가와 새 강아지 소개를 별도로 제공한다', (approvalStatus) => {
    const pet = { ...pendingPet, approvalStatus };
    const onAddPhotos = vi.fn();
    const onUpload = vi.fn();
    render(<MyPetsScreen pets={[pet]} loading={false} error="" onRetry={vi.fn()} onMeet={vi.fn()} onShare={vi.fn()} onUpload={onUpload} onAddPhotos={onAddPhotos} />);

    fireEvent.click(screen.getByRole('button', { name: '사진 더 올리기' }));
    expect(onAddPhotos).toHaveBeenCalledWith(pet);
    expect(onUpload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '강아지 한 마리 더 소개하기' }));
    expect(onUpload).toHaveBeenCalledOnce();
  });

  it.each(['rejected', 'paused', 'deleted'] as const)('%s 강아지는 사진 추가를 열지 않는다', (approvalStatus) => {
    render(<MyPetsScreen pets={[{ ...pendingPet, approvalStatus }]} loading={false} error="" onRetry={vi.fn()} onMeet={vi.fn()} onShare={vi.fn()} onUpload={vi.fn()} onAddPhotos={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '사진 더 올리기' })).not.toBeInTheDocument();
  });
});
