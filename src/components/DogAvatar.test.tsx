import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COAT_COLOR_HEX, DogAvatar, EAR_VISUAL_SPECS, getEarVisualSpec, getSolidCoatShade } from './DogAvatar';
import type { PetTraitsV1 } from '../types';

const traits: PetTraitsV1 = {
  schemaVersion: 1,
  earShape: 'floppy',
  headShape: 'round',
  baseColor: 'cream',
  secondaryColor: 'caramel',
  markingPattern: 'brow',
  muzzle: 'short',
  confidence: 0.96,
};

describe('DogAvatar expressions', () => {
  it('renders three distinct head outlines at the shared avatar boundary', () => {
    const neat = render(<DogAvatar traits={traits} style={{ schemaVersion: 1, coatMode: 'point', furStyle: 'neat' }} />);
    const neatPath = neat.container.querySelector('[data-head-outline]')?.getAttribute('d');
    neat.unmount();
    const fluffy = render(<DogAvatar traits={traits} style={{ schemaVersion: 1, coatMode: 'point', furStyle: 'fluffy' }} />);
    const fluffyPath = fluffy.container.querySelector('[data-head-outline]')?.getAttribute('d');
    fluffy.unmount();
    const cloud = render(<DogAvatar traits={traits} style={{ schemaVersion: 1, coatMode: 'point', furStyle: 'cloud' }} />);
    const cloudPath = cloud.container.querySelector('[data-head-outline]')?.getAttribute('d');
    expect(new Set([neatPath, fluffyPath, cloudPath]).size).toBe(3);
    expect(fluffyPath).toContain('C56 130 74 134 90 134 C106 134 124 130 136 120');
    expect(cloud.container.querySelector('[data-head-fill]')).toHaveAttribute('data-fur-style', 'cloud');
  });

  it('uses only a subtle derived shade for a true single-color dog', () => {
    const solidTraits = { ...traits, baseColor: 'white', secondaryColor: 'white', markingPattern: 'none' } as const;
    const { container } = render(<DogAvatar traits={solidTraits} style={{ schemaVersion: 1, coatMode: 'solid', furStyle: 'fluffy' }} />);
    expect(container.querySelector('[data-head-fill]')).toHaveAttribute('fill', COAT_COLOR_HEX.white);
    expect(container.querySelector('[data-head-fill]')).toHaveAttribute('data-coat-mode', 'solid');
    expect(container.querySelector('[data-ear-shape="floppy"]')).toHaveAttribute('fill', getSolidCoatShade('white'));
    expect(container.querySelector('[data-head-markings]')?.children).toHaveLength(0);
  });
  it('renders the safe default expression for existing data', () => {
    const { container } = render(<DogAvatar traits={traits} panting />);
    expect(container.querySelector('[data-brow-style]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-tongue-shape="drop"]')).toBeInTheDocument();
  });

  it('renders a selected eyebrow and tongue independently from coat markings', () => {
    const { container } = render(<DogAvatar traits={traits} expression={{ browStyle: 'caterpillar', tongueShape: 'side' }} panting />);
    expect(container.querySelector('[data-brow-style="caterpillar"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tongue-shape="side"]')).toBeInTheDocument();
    expect(container.querySelector('.dog-tongue--side')).toBeInTheDocument();
  });

  it('renders a curated signature without changing ordinary dogs', () => {
    const curated = render(<DogAvatar traits={traits} signature="sky-bandana" />);
    expect(curated.container.querySelector('[data-pet-signature="sky-bandana"]')).toBeInTheDocument();
    curated.unmount();

    const ordinary = render(<DogAvatar traits={traits} />);
    expect(ordinary.container.querySelector('[data-pet-signature]')).not.toBeInTheDocument();
  });

  it('renders the early-friend milk carton as Wooyoo\'s exclusive signature', () => {
    const { container } = render(<DogAvatar traits={traits} signature="milk-carton" />);
    expect(container.querySelector('[data-pet-signature="milk-carton"]')).toBeInTheDocument();
  });

  it('uses a rounded birthday bib for Baechu\'s exclusive signature', () => {
    const baechuTraits = { ...traits, baseColor: 'white', secondaryColor: 'white', markingPattern: 'none' } as const;
    const { container } = render(<DogAvatar traits={baechuTraits} style={{ schemaVersion: 1, coatMode: 'solid', furStyle: 'cloud' }} signature="birthday-star" />);
    expect(container.querySelector('[data-birthday-part="bib"]')).toHaveAttribute(
      'd',
      expect.stringContaining('C121 124 117 138 105 144'),
    );
    expect(container.querySelector('[data-ear-shape="floppy"]')).toHaveAttribute('fill', '#FFF9EE');
  });

  it('renders Titi\'s brighter backpack with a separate flap and pocket', () => {
    const { container } = render(<DogAvatar traits={traits} signature="gray-backpack" />);
    expect(container.querySelector('[data-backpack-part="body"]')).toHaveAttribute('fill', '#B4BEC6');
    expect(container.querySelectorAll('[data-pet-signature="gray-backpack"] path')).toHaveLength(6);
  });

  it('uses the Haneul and Gureumi reference specs for ordinary upright and floppy ears', () => {
    expect(getEarVisualSpec('floppy')).toBe(EAR_VISUAL_SPECS.floppy);
    expect(getEarVisualSpec('floppy', 'high-floppy')).toBe(EAR_VISUAL_SPECS.floppy);
    expect(getEarVisualSpec('upright')).toBe(EAR_VISUAL_SPECS.upright);
    expect(getEarVisualSpec('upright', 'soft-upright')).toBe(EAR_VISUAL_SPECS.upright);

    const upright = render(<DogAvatar traits={{ ...traits, earShape: 'upright' }} />);
    const uprightEars = upright.container.querySelector('[data-ear-shape="upright"]');
    expect(uprightEars).toHaveAttribute('data-ear-family', 'haneul');
    expect(uprightEars).toHaveAttribute('data-ear-layer', 'back');
    expect(uprightEars?.querySelector('[data-ear-part="left-fill"]')).toHaveAttribute('d', EAR_VISUAL_SPECS.upright.leftPath);
    upright.unmount();

    const floppy = render(<DogAvatar traits={traits} />);
    const floppyEars = floppy.container.querySelector('[data-ear-shape="floppy"]');
    expect(floppyEars).toHaveAttribute('data-ear-family', 'gureumi');
    expect(floppyEars).toHaveAttribute('data-ear-layer', 'front');
    expect(floppyEars?.querySelector('[data-ear-part="left-fill"]')).toHaveAttribute('d', EAR_VISUAL_SPECS.floppy.leftPath);
    expect(floppyEars?.querySelector('[data-ear-part="left-fill"]')).toHaveAttribute('transform', expect.stringContaining('scale(.85)'));
  });

  it('keeps Gureumi white ears and Haneul hairpin as curated-only details', () => {
    const ordinary = render(<DogAvatar traits={traits} />);
    expect(ordinary.container.querySelector('[data-ear-shape="floppy"]')).toHaveAttribute('fill', COAT_COLOR_HEX.caramel);
    expect(ordinary.container.querySelector('[data-pet-signature]')).not.toBeInTheDocument();
    ordinary.unmount();

    const gureumi = render(<DogAvatar traits={traits} signature="sky-bandana" earVariant="high-floppy" />);
    expect(gureumi.container.querySelector('[data-ear-variant="high-floppy"]')).toHaveAttribute('fill', COAT_COLOR_HEX.white);
    expect(gureumi.container.querySelector('[data-pet-signature="sky-bandana"]')).toBeInTheDocument();
    gureumi.unmount();

    const haneul = render(<DogAvatar traits={{ ...traits, earShape: 'upright' }} signature="peach-hairpin" earVariant="soft-upright" />);
    expect(haneul.container.querySelector('[data-pet-signature="peach-hairpin"]')).toBeInTheDocument();
    expect(haneul.container.querySelector('[data-ear-variant="soft-upright"]')).toHaveAttribute('data-ear-layer', 'back');
  });

  it('uses open attachment outlines on front ears so the forehead has no doubled seam', () => {
    const { container } = render(<DogAvatar traits={traits} size={114} />);
    const ears = container.querySelector('[data-ear-shape="floppy"]');
    const headOutline = container.querySelector('[data-head-outline]');

    if (!(ears && headOutline)) throw new Error('front ear layers should render');
    expect(ears).toHaveAttribute('data-ear-seam', 'open-attachment');
    expect(ears.querySelector('[data-ear-part="left-fill"]')).toHaveAttribute('stroke', 'none');
    expect(ears.querySelector('[data-ear-part="left-outline"]')?.getAttribute('d')).not.toMatch(/Z$/);
    expect(headOutline.compareDocumentPosition(ears) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('derives semi ears from Haneul and compact rounded ears from Gureumi', () => {
    const semi = render(<DogAvatar traits={{ ...traits, earShape: 'semi' }} />);
    const semiEars = semi.container.querySelector('[data-ear-shape="semi"]');
    expect(semiEars).toHaveAttribute('data-ear-family', 'haneul');
    expect(semiEars).toHaveAttribute('data-ear-layer', 'back');
    expect(semiEars?.querySelector('[data-ear-part="left-fold"]')).toBeInTheDocument();
    semi.unmount();

    const { container } = render(<DogAvatar traits={{ ...traits, earShape: 'rounded' }} size={114} />);
    const ears = container.querySelector('[data-ear-shape="rounded"]');
    const headOutline = container.querySelector('[data-head-outline]');

    if (!(ears && headOutline)) throw new Error('rounded ear layers should render');
    expect(ears).toHaveAttribute('data-ear-family', 'gureumi');
    expect(ears).toHaveAttribute('data-ear-layer', 'front');
    expect(ears.querySelector('[data-ear-part="left-fill"]')).toHaveAttribute('d', EAR_VISUAL_SPECS.rounded.leftPath);
    expect(ears.querySelector('[data-ear-part="left-fill"]')).toHaveAttribute('d', expect.stringContaining('M65 34'));
    expect(headOutline.compareDocumentPosition(ears) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clips photo-inspired markings to the face boundary', () => {
    const { container } = render(<DogAvatar traits={{ ...traits, earShape: 'rounded', markingPattern: 'blaze' }} size={114} />);
    const markings = container.querySelector('[data-head-markings]');

    expect(markings).toHaveAttribute('clip-path', expect.stringMatching(/^url\(#dog-head-/));
    const blaze = markings?.querySelector('[data-marking-pattern="blaze"]');
    expect(blaze).toHaveAttribute('d', 'M90 16 C82 23 82 31 84.5 36 C86 39 88 41 90 43 C92 41 94 39 95.5 36 C98 31 98 23 90 16Z');
    expect(blaze?.getAttribute('d')).not.toContain('70');
  });

  it('repairs legacy same-color visible markings at the render boundary', () => {
    const { container } = render(<DogAvatar traits={{ ...traits, baseColor: 'white', secondaryColor: 'white', markingPattern: 'blaze' }} />);

    expect(container.querySelector('[data-head-fill]')).toHaveAttribute('fill', COAT_COLOR_HEX.white);
    expect(container.querySelector('[data-marking-pattern="blaze"]')).toHaveAttribute('fill', COAT_COLOR_HEX.caramel);
    expect(container.querySelector('[data-ear-shape="floppy"]')).toHaveAttribute('fill', COAT_COLOR_HEX.caramel);
  });

  it.each([
    ['ribbon', 'pink'],
    ['scarf', 'sky'],
    ['vest', 'yellow'],
    ['ball', 'mint'],
  ] as const)('renders the %s accessory with its reviewed color at every avatar size', (kind, color) => {
    const { container } = render(<DogAvatar traits={traits} size={64} accessory={{ kind, color, assetKey: `builtin:${kind}` }} />);
    expect(container.querySelector(`[data-pet-accessory="${kind}"]`)).toHaveAttribute('data-accessory-color', color);
  });
});
