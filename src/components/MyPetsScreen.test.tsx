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
};

describe('MyPetsScreen', () => {
  it('lets the owner meet and share a pending character while explaining the review boundary', () => {
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
    expect(screen.getByText('내 집과 공유 링크에서 캐릭터를 먼저 만날 수 있어요.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '만나기' }));
    fireEvent.click(screen.getByRole('button', { name: '공유' }));
    expect(onMeet).toHaveBeenCalledWith(pendingPet);
    expect(onShare).toHaveBeenCalledWith(pendingPet);
  });
});
