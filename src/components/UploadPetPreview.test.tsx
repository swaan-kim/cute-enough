import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PetTraitsV1 } from '../types';
import { createPetAccessory } from '../lib/petAccessory';
import { UploadPetPreview } from './UploadPetPreview';

const traits: PetTraitsV1 = {
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'white',
  secondaryColor: 'caramel',
  markingPattern: 'blaze',
  muzzle: 'short',
  confidence: 1,
};

afterEach(() => vi.restoreAllMocks());

describe('UploadPetPreview', () => {
  it('keeps a live compact preview fixed after the large preview leaves the viewport', () => {
    let sentinelBottom = 40;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return {
        bottom: this.classList.contains('upload-preview-sentinel') ? sentinelBottom : 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });

    const { container, rerender } = render(
      <UploadPetPreview traits={traits} name="솜이" accessory={createPetAccessory('ribbon', 'pink')} />,
    );
    expect(screen.queryByText('바꾼 모습이 바로 반영돼요')).not.toBeInTheDocument();

    sentinelBottom = -1;
    act(() => fireEvent.scroll(window));
    expect(screen.getByText('바꾼 모습이 바로 반영돼요')).toBeInTheDocument();
    expect(container.querySelector('.upload-pet-preview-compact [data-pet-accessory="ribbon"]')).toBeInTheDocument();

    rerender(<UploadPetPreview traits={traits} name="솜이" accessory={createPetAccessory('ball', 'mint')} />);
    expect(container.querySelector('.upload-pet-preview-compact [data-pet-accessory="ball"]')).toHaveAttribute('data-accessory-color', 'mint');

    sentinelBottom = 20;
    act(() => fireEvent.scroll(window));
    expect(screen.queryByText('바꾼 모습이 바로 반영돼요')).not.toBeInTheDocument();
  });
});
