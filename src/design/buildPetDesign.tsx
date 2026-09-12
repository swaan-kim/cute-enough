// Geometry authoring only: generated documents are stored independently of this compiler.
import { Fragment, isValidElement, type ReactNode } from 'react';
import { validatePetDesign, type PetDesignV1, type SvgDesignNode } from '../../supabase/functions/_shared/pet-design';
import type { CoatColor, EarShape, FurStyle, PetAccessory, PetExpression, PetStyleV1, PetTraitsV1 } from '../types';
import type { PetEarVariant, PetSignature } from '../data/petSignature';
import { normalizePetTraitColors } from '../lib/petTraits';
import { PET_ACCESSORY_COLOR_HEX } from '../lib/petAccessory';
import { normalizePetStyle } from '../lib/petStyle';

export const COAT_COLOR_HEX: Readonly<Record<CoatColor, string>> = {
  cream: '#F6DEB3', caramel: '#C98955', chocolate: '#714536', black: '#3C3B41', gray: '#A8A6AE', white: '#FFFDF8',
};

export interface EarVisualSpec {
  /** 하늘형인지 구르미형인지 선택 UI에서도 같은 기준을 설명할 때 사용해요. */
  family: 'haneul' | 'gureumi';
  layer: 'front' | 'back';
  leftPath: string;
  rightPath: string;
  /** 앞 레이어 귀는 머리와 맞닿는 안쪽 선을 빼고 바깥 윤곽만 다시 그려 이중 선을 막아요. */
  leftOuterPath?: string;
  rightOuterPath?: string;
  leftTransform?: string;
  rightTransform?: string;
  leftFoldPath?: string;
  rightFoldPath?: string;
}

const GUREUMI_LEFT_PATH = 'M67 25 C59 14 47 11 37 17 C29 22 26 33 21 44 L14 55 C9 64 13 73 22 77 C32 82 43 75 49 65 C57 51 63 35 67 25Z';
const GUREUMI_RIGHT_PATH = 'M113 25 C121 14 133 11 143 17 C151 22 154 33 159 44 L166 55 C171 64 167 73 158 77 C148 82 137 75 131 65 C123 51 117 35 113 25Z';
const GUREUMI_LEFT_OUTER_PATH = 'M67 25 C59 14 47 11 37 17 C29 22 26 33 21 44 L14 55 C9 64 13 73 22 77 C32 82 43 75 49 65';
const GUREUMI_RIGHT_OUTER_PATH = 'M113 25 C121 14 133 11 143 17 C151 22 154 33 159 44 L166 55 C171 64 167 73 158 77 C148 82 137 75 131 65';

/**
 * 선택 카드와 실제 강아지가 함께 쓰는 유일한 귀 도형 정의예요.
 * floppy/upright가 각각 현재 구르미/하늘의 기준형이고, 나머지는 그 두 형태의 작은 변형이에요.
 */
export const EAR_VISUAL_SPECS: Readonly<Record<EarShape, EarVisualSpec>> = {
  floppy: {
    family: 'gureumi',
    layer: 'front',
    leftPath: GUREUMI_LEFT_PATH,
    rightPath: GUREUMI_RIGHT_PATH,
    leftOuterPath: GUREUMI_LEFT_OUTER_PATH,
    rightOuterPath: GUREUMI_RIGHT_OUTER_PATH,
    leftTransform: 'translate(-3 0) translate(67 25) scale(.85) translate(-67 -25)',
    rightTransform: 'translate(3 0) translate(113 25) scale(.85) translate(-113 -25)',
  },
  upright: {
    family: 'haneul',
    layer: 'back',
    leftPath: 'M66 54 C60 39 54 24 45 17 C37 11 27 13 22 21 C17 33 24 54 40 72Z',
    rightPath: 'M114 54 C120 39 126 24 135 17 C143 11 153 13 158 21 C163 33 156 54 140 72Z',
  },
  semi: {
    family: 'haneul',
    layer: 'back',
    leftPath: 'M66 54 C61 40 56 27 48 20 C41 14 32 13 26 18 C22 22 21 28 25 32 C29 36 35 35 40 31 C38 45 41 59 49 70Z',
    rightPath: 'M114 54 C119 40 124 27 132 20 C139 14 148 13 154 18 C158 22 159 28 155 32 C151 36 145 35 140 31 C142 45 139 59 131 70Z',
    leftFoldPath: 'M25 32 C31 31 36 27 40 22',
    rightFoldPath: 'M155 32 C149 31 144 27 140 22',
  },
  rounded: {
    family: 'gureumi',
    layer: 'front',
    leftPath: 'M65 34 C58 25 49 22 41 26 C34 30 31 39 27 47 L22 54 C17 62 21 70 29 73 C38 77 47 71 52 63 C58 52 62 41 65 34Z',
    rightPath: 'M115 34 C122 25 131 22 139 26 C146 30 149 39 153 47 L158 54 C163 62 159 70 151 73 C142 77 133 71 128 63 C122 52 118 41 115 34Z',
    leftOuterPath: 'M65 34 C58 25 49 22 41 26 C34 30 31 39 27 47 L22 54 C17 62 21 70 29 73 C38 77 47 71 52 63',
    rightOuterPath: 'M115 34 C122 25 131 22 139 26 C146 30 149 39 153 47 L158 54 C163 62 159 70 151 73 C142 77 133 71 128 63',
    leftTransform: 'translate(-2 1)',
    rightTransform: 'translate(2 1)',
  },
};

const CURATED_EAR_SHAPES: Readonly<Record<PetEarVariant, EarShape>> = {
  'high-floppy': 'floppy',
  'soft-upright': 'upright',
};

const COOKIE_EARS: EarVisualSpec = {
  family: 'haneul',
  layer: 'back',
  leftPath: 'M35 47 C35 35 38 25 43 17 Q46 13 50 18 L65 33Z',
  rightPath: 'M145 47 C145 35 142 25 137 17 Q134 13 130 18 L115 33Z',
};
const COOKIE_HEAD_PATH = 'M90 18 Q84 12 78 20 Q66 16 58 27 Q45 24 40 37 Q31 39 33 51 Q24 55 29 67 Q22 75 29 84 Q26 95 38 99 C43 112 65 123 90 124 C115 123 137 112 142 99 Q154 95 151 84 Q158 75 151 67 Q156 55 147 51 Q149 39 140 37 Q135 24 122 27 Q114 16 102 20 Q96 12 90 18Z';

export function getEarVisualSpec(earShape: EarShape, earVariant?: PetEarVariant): EarVisualSpec {
  return EAR_VISUAL_SPECS[earVariant ? CURATED_EAR_SHAPES[earVariant] : earShape];
}

export interface BuildPetDesignInput {
  traits: PetTraitsV1;
  style?: PetStyleV1;
  expression?: PetExpression;
  signature?: PetSignature | 'chocolate-cookie' | 'black-sunglasses' | 'strawberry-milk' | 'chive-bundle' | 'chew-bone' | 'cheese-wedge' | 'cloud-cotton-candy';
  earVariant?: PetEarVariant;
  accessory?: PetAccessory;
}

function mixHex(source: string, target: string, amount: number): string {
  const sourceValue = Number.parseInt(source.slice(1), 16);
  const targetValue = Number.parseInt(target.slice(1), 16);
  const channel = (shift: number) => Math.round(
    ((sourceValue >> shift) & 0xff) * (1 - amount) + ((targetValue >> shift) & 0xff) * amount,
  );
  return `#${[channel(16), channel(8), channel(0)].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function getSolidCoatShade(color: CoatColor): string {
  return mixHex(COAT_COLOR_HEX[color], color === 'black' ? '#000000' : '#6D5548', 0.07);
}

export function getHeadOutlinePath(headRx: number, furStyle: FurStyle): string {
  const left = 90 - headRx;
  const right = 90 + headRx;
  if (furStyle === 'fluffy') {
    return `M90 10 C82 7 77 12 74 16 C62 10 52 16 49 22 C35 21 ${left + 4} 32 ${left + 2} 44 C${left - 3} 50 ${left - 2} 59 ${left + 1} 64 C${left - 4} 73 ${left} 84 ${left + 7} 88 C${left + 7} 102 ${left + 16} 114 ${left + 28} 120 C${left + 40} 130 74 134 90 134 C106 134 ${right - 40} 130 ${right - 28} 120 C${right - 16} 114 ${right - 7} 102 ${right - 7} 88 C${right} 84 ${right + 4} 73 ${right - 1} 64 C${right + 2} 59 ${right + 3} 50 ${right - 2} 44 C${right - 4} 32 145 21 131 22 C128 16 118 10 106 16 C103 12 98 7 90 10Z`;
  }
  if (furStyle === 'cloud') {
    return `M90 11 C84 4 75 7 72 15 C64 8 53 12 51 21 C40 17 29 25 31 35 C20 35 ${left - 1} 45 ${left + 3} 55 C${left - 5} 61 ${left - 3} 74 ${left + 6} 78 C${left - 1} 88 ${left + 6} 101 ${left + 17} 102 C${left + 15} 115 54 126 67 123 C73 133 84 134 90 128 C96 134 107 133 113 123 C126 126 ${right - 15} 115 ${right - 17} 102 C${right - 6} 101 ${right + 1} 88 ${right - 6} 78 C${right + 3} 74 ${right + 5} 61 ${right - 3} 55 C${right + 1} 45 160 35 149 35 C151 25 140 17 129 21 C127 12 116 8 108 15 C105 7 96 4 90 11Z`;
  }
  return `M90 10 C52 10 ${left} 31 ${left} 70 C${left} 109 52 130 90 130 C128 130 ${right} 109 ${right} 70 C${right} 31 128 10 90 10Z`;
}

export function buildPetDesign({ traits, style, expression = { browStyle: 'none', tongueShape: 'drop' }, signature, earVariant, accessory }: BuildPetDesignInput): PetDesignV1 {
  const isCookie = signature === 'chocolate-cookie';
  const headClipId = 'head-clip';
  const visualTraits = normalizePetTraitColors(traits);
  const visualStyle = normalizePetStyle(visualTraits, style);
  const base = COAT_COLOR_HEX[visualTraits.baseColor];
  const secondary = visualStyle.coatMode === 'solid'
    ? getSolidCoatShade(visualTraits.baseColor)
    : COAT_COLOR_HEX[visualTraits.secondaryColor];
  const ears = isCookie ? COOKIE_EARS : getEarVisualSpec(visualTraits.earShape, earVariant);
  const earsInFront = ears.layer === 'front';
  // 구르미의 흰 귀는 강아지 전용 예외이고, 일반 포근한 귀는 선택한 포인트 털색을 따라가요.
  const earFill = earVariant === 'high-floppy'
    ? COAT_COLOR_HEX.white
    : signature === 'birthday-star'
      ? '#FFF9EE'
      : secondary;
  const headRx = visualTraits.headShape === 'long' ? 61 : visualTraits.headShape === 'oval' ? 68 : 74;
  const headPath = isCookie ? COOKIE_HEAD_PATH : getHeadOutlinePath(headRx, visualStyle.furStyle);
  const accessoryColor = accessory ? PET_ACCESSORY_COLOR_HEX[accessory.color] : undefined;
  const earLayer = (
    <g
      className={`dog-ears dog-ears--${visualTraits.earShape}`}
      data-ear-shape={visualTraits.earShape}
      data-ear-variant={earVariant}
      data-ear-family={ears.family}
      data-ear-layer={ears.layer}
      data-ear-seam={earsInFront ? 'open-attachment' : 'head-masked'}
      fill={earFill}
      stroke="#25222A"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-pet-ear-detail={isCookie ? 'cookie-pomeranian' : undefined}
    >
      {earsInFront ? (
        <>
          <path data-ear-part="left-fill" d={ears.leftPath} transform={ears.leftTransform} stroke="none" />
          <path data-ear-part="right-fill" d={ears.rightPath} transform={ears.rightTransform} stroke="none" />
          <path data-ear-part="left-outline" d={ears.leftOuterPath} transform={ears.leftTransform} fill="none" />
          <path data-ear-part="right-outline" d={ears.rightOuterPath} transform={ears.rightTransform} fill="none" />
        </>
      ) : (
        <>
          <path data-ear-part="left-fill" d={ears.leftPath} transform={ears.leftTransform} />
          <path data-ear-part="right-fill" d={ears.rightPath} transform={ears.rightTransform} />
        </>
      )}
      {ears.leftFoldPath && <path data-ear-part="left-fold" d={ears.leftFoldPath} transform={ears.leftTransform} fill="none" strokeWidth="3" />}
      {ears.rightFoldPath && <path data-ear-part="right-fold" d={ears.rightFoldPath} transform={ears.rightTransform} fill="none" strokeWidth="3" />}
    </g>
  );
  const tree = (
    <>
        <defs data-design-part="head-clip">
          <clipPath id={headClipId}>
            <path d={headPath} />
          </clipPath>
        </defs>
        <g className="dog-tail"><path d="M145 112c25-9 29-25 18-29-10-4-14 8-8 15" fill="none" stroke="#25222A" strokeWidth="7" strokeLinecap="round" /></g>
        <ellipse data-design-part="body" cx="90" cy="123" rx="59" ry="22" fill={base} stroke="#25222A" strokeWidth="5" />
        {signature === 'gray-backpack' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none">
            <path data-backpack-part="body" d="M131 100 C133 89 142 84 154 86 C166 88 171 99 171 113 L169 138 Q157 147 133 138Z" fill="#B4BEC6" stroke="#25222A" strokeWidth="4" strokeLinejoin="round" />
            <path d="M140 94 C143 83 157 82 162 95" fill="none" stroke="#68737C" strokeWidth="5" strokeLinecap="round" />
            <path d="M133 103 Q151 91 169 103 L170 117 Q151 124 133 116Z" fill="#CED5DA" stroke="#25222A" strokeWidth="3" strokeLinejoin="round" />
            <path d="M140 115 Q136 128 140 140" fill="none" stroke="#69747D" strokeWidth="3" strokeLinecap="round" />
            <path d="M150 120 Q160 117 169 123 L168 137 Q159 142 150 137Z" fill="#E4E8EB" stroke="#25222A" strokeWidth="3" strokeLinejoin="round" />
            <path d="M154 121 L154 137" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity=".9" />
            <circle cx="161" cy="128" r="2.5" fill="#FFD25F" stroke="#25222A" strokeWidth="1.5" />
          </g>
        )}
        {accessory?.kind === 'vest' && (
          <g data-pet-accessory="vest" data-accessory-color={accessory.color} aria-hidden="true" pointerEvents="none">
            <path d="M50 116 Q90 104 130 116 L126 140 Q90 151 54 140Z" fill={accessoryColor} stroke="#25222A" strokeWidth="4" strokeLinejoin="round" />
            <path d="M76 112 Q90 126 104 112" fill="none" stroke="#FFF9F4" strokeWidth="4" strokeLinecap="round" />
          </g>
        )}
        {(signature === 'sky-bandana' || signature === 'cloud-cotton-candy') && (
          <g data-pet-signature="sky-bandana" aria-hidden="true" pointerEvents="none">
            <path d="M61 113 Q90 130 119 113 L108 133 Q100 138 90 132 Q80 138 72 133Z" fill="#79C8F2" stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M90 130 L105 145 L89 146 L78 135Z" fill="#55B5E8" stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
          </g>
        )}
        {!earsInFront && earLayer}
        {isCookie && <g data-cookie-ear-inner fill="#F4C8C9" stroke="none"><path d="M42 34 Q43 27 46 23 L55 33Z" /><path d="M138 34 Q137 27 134 23 L125 33Z" /></g>}
        <path data-head-fill data-fur-style={visualStyle.furStyle} data-coat-mode={visualStyle.coatMode} d={headPath} fill={base} />
        <g data-head-markings clipPath={`url(#${headClipId})`}>
          {visualTraits.markingPattern === 'blaze' && <path data-marking-pattern="blaze" d="M90 16 C82 23 82 31 84.5 36 C86 39 88 41 90 43 C92 41 94 39 95.5 36 C98 31 98 23 90 16Z" fill={secondary} opacity=".95" />}
          {visualTraits.markingPattern === 'mask' && <path data-marking-pattern="mask" d="M27 53 Q47 25 73 40 L67 72 Q42 82 27 53M153 53 Q133 25 107 40 L113 72 Q138 82 153 53" fill={secondary} opacity=".9" />}
          {visualTraits.markingPattern === 'brow' && <g data-marking-pattern="brow"><ellipse cx="61" cy="43" rx="11" ry="7" fill={secondary} /><ellipse cx="119" cy="43" rx="11" ry="7" fill={secondary} /></g>}
          {visualTraits.markingPattern === 'spots' && <g data-marking-pattern="spots"><circle cx="53" cy="39" r="13" fill={secondary} /><circle cx="126" cy="83" r="10" fill={secondary} /></g>}
        </g>
        <path data-head-outline data-fur-style={visualStyle.furStyle} d={headPath} fill="none" stroke="#25222A" strokeWidth="5" strokeLinejoin="round" />
        {earsInFront && earLayer}
        {accessory?.kind === 'ribbon' && (
          <g data-pet-accessory="ribbon" data-accessory-color={accessory.color} aria-hidden="true" pointerEvents="none" transform="translate(132 31) rotate(12)">
            <path d="M0 6 C-11-3-16 7-8 13 L0 10Z" fill={accessoryColor} stroke="#25222A" strokeWidth="3" strokeLinejoin="round" />
            <path d="M1 6 C12-3 17 7 9 13 L1 10Z" fill={accessoryColor} stroke="#25222A" strokeWidth="3" strokeLinejoin="round" />
            <circle cx="0.5" cy="8" r="4" fill="#FFF8F0" stroke="#25222A" strokeWidth="2.5" />
          </g>
        )}
        {accessory?.kind === 'scarf' && (
          <g data-pet-accessory="scarf" data-accessory-color={accessory.color} aria-hidden="true" pointerEvents="none">
            <path d="M56 110 Q90 127 124 110 L116 124 Q101 132 90 126 Q79 132 64 124Z" fill={accessoryColor} stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M91 126 L107 145 L89 145 L80 133Z" fill={accessoryColor} stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
          </g>
        )}
        {signature === 'peach-hairpin' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" transform="translate(126 29) rotate(12)">
            <path d="M0 6 C-11-3-16 7-8 13 L0 10Z" fill="#FF9E91" stroke="#25222A" strokeWidth="3" strokeLinejoin="round" />
            <path d="M1 6 C12-3 17 7 9 13 L1 10Z" fill="#FFB6A9" stroke="#25222A" strokeWidth="3" strokeLinejoin="round" />
            <circle cx="0.5" cy="8" r="4" fill="#FFE178" stroke="#25222A" strokeWidth="2.5" />
          </g>
        )}
        {signature === 'mint-collar' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none">
            <path d="M54 113 Q90 128 126 113" fill="none" stroke="#72D6BD" strokeWidth="7" strokeLinecap="round" />
            <circle cx="90" cy="128" r="7" fill="#B4F0E0" stroke="#25222A" strokeWidth="3" />
          </g>
        )}
        {signature === 'lemon-star' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" transform="translate(132 37)">
            <path d="M0-10 3-3 11-2 5 3 7 11 0 7-7 11-5 3-11-2-3-3Z" fill="#FFD95B" stroke="#25222A" strokeWidth="3" strokeLinejoin="round" />
          </g>
        )}
        {signature === 'milk-carton' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none">
            <path d="M20 111 L28 101 H45 L52 111 V143 H20Z" fill="#F9FCFF" stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M28 101 L35 111 H52 L45 101Z" fill="#BCE9F6" stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M35 111 V143" stroke="#25222A" strokeWidth="3" />
            <path d="M22 124 H34 V141 H22Z" fill="#BCE9F6" />
            <path d="M39 122 C43 117 49 122 46 127 L42 132 L38 127 C35 124 36 121 39 122Z" fill="#FF8EAA" stroke="#25222A" strokeWidth="2" strokeLinejoin="round" />
            <path d="M43 99 L48 88" fill="none" stroke="#25222A" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M49 88 L53 98" fill="none" stroke="#FF8EAA" strokeWidth="3.5" strokeLinecap="round" />
          </g>
        )}
        {signature === 'birthday-star' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none">
            <path d="M72 28 L90 2 L108 28Z" fill="#FFB0C4" stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M77 21 H103" fill="none" stroke="#FFF5C7" strokeWidth="4" strokeLinecap="round" />
            <circle cx="90" cy="4" r="7" fill="#FF8EAA" stroke="#25222A" strokeWidth="3" />
            <path data-birthday-part="bib" d="M60 109 Q90 124 120 109 C121 124 117 138 105 144 C96 149 84 149 75 144 C63 138 59 124 60 109Z" fill="#FFF7F9" stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" />
            <path d="M70 117 Q90 128 110 117" fill="none" stroke="#FFB0C4" strokeWidth="4" strokeLinecap="round" />
            <path d="M86 128 C89 123 96 125 96 130 C96 134 92 137 90 139 C88 137 83 134 83 130 C83 126 87 124 90 128 C92 124 96 126 96 130" fill="#FF8EAA" stroke="#25222A" strokeWidth="2" strokeLinejoin="round" />
          </g>
        )}
        {!isCookie && expression.browStyle !== 'none' && (
          <g className={`dog-brows dog-brows--${expression.browStyle}`} data-brow-style={expression.browStyle} fill="none" stroke={secondary} strokeLinecap="round">
            {expression.browStyle === 'soft' && <><path d="M54 49 Q61 45 68 49" strokeWidth="4" /><path d="M112 49 Q119 45 126 49" strokeWidth="4" /></>}
            {expression.browStyle === 'caterpillar' && <><path d="M52 48 Q56 43 61 47 Q66 42 70 48" strokeWidth="6" /><path d="M110 48 Q114 42 119 47 Q124 43 128 48" strokeWidth="6" /></>}
            {expression.browStyle === 'angled' && <><path d="M53 44 L68 50" strokeWidth="5" /><path d="M112 50 L127 44" strokeWidth="5" /></>}
          </g>
        )}
        <circle data-design-part="left-eye" cx={isCookie ? 70 : 65} cy="65" r="5.5" fill="#25222A" /><circle data-design-part="right-eye" cx={isCookie ? 110 : 115} cy="65" r="5.5" fill="#25222A" />
        {signature === 'black-sunglasses' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" stroke="#25222A" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round">
            <path d="M29 53 L43 58 M137 58 L151 53 M83 59 Q90 54 97 59" fill="none" />
            <path d="M42 53 Q62 48 83 54 L81 67 C79 78 70 81 59 78 C48 76 42 66 42 53Z" fill="#34323B" />
            <path d="M138 53 Q118 48 97 54 L99 67 C101 78 110 81 121 78 C132 76 138 66 138 53Z" fill="#34323B" />
            <path d="M49 56 Q62 53 75 56 M104 56 Q117 53 130 56" stroke="#7D818D" strokeWidth="2" fill="none" />
            <path d="M51 62 L58 58 M106 62 L113 58" stroke="#C4CAD3" strokeWidth="2.5" opacity=".8" />
          </g>
        )}
        <g data-design-part="muzzle" data-cookie-muzzle={isCookie ? 'short' : undefined} transform={isCookie ? 'translate(90 88) scale(.75) translate(-90 -88)' : undefined}>
        <ellipse cx="90" cy="88" rx={visualTraits.muzzle === 'long' ? 29 : 24} ry="20" fill={secondary} stroke="#25222A" strokeWidth="3.5" />
        <path d="M83 82 Q90 76 97 82 Q95 91 90 91 Q85 91 83 82" fill="#27242A" />
        <path d="M90 91 L90 98 M90 98 Q82 105 77 98 M90 98 Q98 105 103 98" fill="none" stroke="#25222A" strokeWidth="3.5" strokeLinecap="round" />
        <g className={`dog-tongue dog-tongue--${expression.tongueShape}`} data-tongue-shape={expression.tongueShape}>
          {expression.tongueShape === 'drop' && <path d="M86 100 Q90 113 94 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
          {expression.tongueShape === 'round' && <path d="M85 100 C85 108 87 114 90 114 C93 114 95 108 95 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
          {expression.tongueShape === 'wide' && <path d="M83 100 C83 108 86 113 90 113 C94 113 97 108 97 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
          {expression.tongueShape === 'side' && <path d="M88 100 C91 102 97 103 98 107 C100 111 98 114 95 113 C92 112 90 106 88 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
        </g>
        </g>
        {signature === 'black-sunglasses' && (
          <g data-seolgi-bow-tie aria-hidden="true" pointerEvents="none" transform="translate(90 132)" stroke="#25222A" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round">
            <path d="M-3-2 C-9-6-16-11-18-7 C-20-3-20 3-18 7 C-16 11-9 6-3 2Z" fill="#34323B" />
            <path d="M3-2 C9-6 16-11 18-7 C20-3 20 3 18 7 C16 11 9 6 3 2Z" fill="#34323B" />
            <path d="M-14-4 L-8-1 M8-1 L14-4" fill="none" stroke="#77717F" strokeWidth="1.8" />
            <rect x="-4" y="-5" width="8" height="10" rx="3" fill="#4A4551" />
          </g>
        )}
        <path data-design-part="feet" d="M50 128v15M130 128v15" stroke="#25222A" strokeWidth="7" strokeLinecap="round" />
        {accessory?.kind === 'ball' && signature !== 'cheese-wedge' && (
          <g data-pet-accessory="ball" data-accessory-color={accessory.color} aria-hidden="true" pointerEvents="none">
            <circle cx="150" cy="132" r="14" fill={accessoryColor} stroke="#25222A" strokeWidth="4" />
            <path d="M139 128 Q150 136 161 128 M143 121 Q150 128 157 121" fill="none" stroke="#FFF9F4" strokeWidth="2.5" strokeLinecap="round" opacity=".9" />
          </g>
        )}
        {isCookie && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" transform="translate(146 130) rotate(-12)">
            <path d="M0-19 C11-20 20-10 19 1 C20 12 10 20-1 19 C-12 20-21 10-19-1 C-20-12-10-20 0-19Z" fill="#BE8555" stroke="#4B3027" strokeWidth="3.5" />
            <path d="M-13-7 Q-9-15-1-14" fill="none" stroke="#E4B179" strokeWidth="3" strokeLinecap="round" />
            <path d="M-3-11 L3-12 5-7-1-6Z M9-3 L14 0 11 5 6 2Z M-12 0 L-7-2-4 3-10 5Z M-3 8 L2 6 5 12-1 14Z" fill="#43281F" stroke="#43281F" strokeWidth="1.5" strokeLinejoin="round" />
            <circle cx="-9" cy="11" r="1.3" fill="#905D3B" /><circle cx="10" cy="-10" r="1.3" fill="#905D3B" />
          </g>
        )}
        {signature === 'strawberry-milk' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" stroke="#4E343D" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
            <path d="M153 102 L158 87 H165" fill="none" strokeWidth="5" />
            <path d="M153 102 L158 87 H165" fill="none" stroke="#F78CA8" strokeWidth="2" />
            <path d="M130 110 L137 100 H155 L164 110 V147 H130Z" fill="#FFF0F4" />
            <path d="M137 100 L144 110 H164 L155 100Z" fill="#FFB1C7" />
            <path d="M144 110 H164 V147 H144Z" fill="#F690B0" />
            <path d="M132 135 H142 V145 H132Z" fill="#F7BDD0" stroke="none" />
            <path d="M148 122 C145 119 145 128 148 132 L154 137 160 131 C164 123 161 118 157 121 Q153 118 148 122Z" fill="#E95778" strokeWidth="1.8" />
            <path d="M148 121 L150 117 154 120 158 117 160 122 154 123Z" fill="#66A96C" stroke="#426D46" strokeWidth="1.5" />
            <path d="M151 126 V127 M157 126 V127 M154 131 V132" stroke="#FFE9AF" strokeWidth="1.5" />
          </g>
        )}
        {signature === 'chive-bundle' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" stroke="#356143" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round">
            <path d="M143 137 Q133 112 124 96 Q136 105 147 136Z" fill="#77B76A" />
            <path d="M146 138 Q133 104 136 84 Q143 104 150 138Z" fill="#4C9B59" />
            <path d="M148 138 Q145 105 153 81 Q153 112 152 139Z" fill="#82BF70" />
            <path d="M151 139 Q155 105 169 90 Q162 112 155 140Z" fill="#479555" />
            <path d="M147 138 Q145 106 144 92 Q154 112 152 140Z" fill="#98CB7F" />
            <path d="M153 139 Q160 116 173 106 Q165 124 157 141Z" fill="#6CAF62" />
            <path d="M143 135 L146 147 M148 136 L151 148 M153 136 L156 147" stroke="#D6DCAF" strokeWidth="3" />
            <path d="M139 128 Q148 132 159 128 L157 135 Q149 139 142 134Z" fill="#E5B985" stroke="#96704B" />
          </g>
        )}
        {signature === 'cheese-wedge' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" transform="translate(146 126) rotate(-8)" stroke="#76512E" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round">
            <path d="M-22 13 L23 14 22 22-22 20Z" fill="#EFAF36" />
            <path d="M-22 13 L3-21 23 14Z" fill="#FFD85E" />
            <path d="M-13 6 L2-14" fill="none" stroke="#FFF2AD" strokeWidth="3" />
            <circle cx="3" cy="-5" r="3.3" fill="#E5A130" stroke="none" />
            <ellipse cx="-3" cy="7" rx="4" ry="3" fill="#E5A130" stroke="none" />
            <circle cx="12" cy="8" r="2.7" fill="#E5A130" stroke="none" />
            <path d="M-15 16 H-10 M13 18 H17" fill="none" stroke="#C88929" strokeWidth="1.8" />
          </g>
        )}
        {signature === 'cloud-cotton-candy' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" stroke="#626778" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round">
            <path d="M149 116 L143 148" fill="none" strokeWidth="7" />
            <path d="M149 116 L143 148" fill="none" stroke="#F4D6A4" strokeWidth="3.6" />
            <path d="M132 120 C123 120 120 112 124 106 C124 99 130 95 136 97 C140 86 153 87 157 96 C165 92 173 98 172 105 C181 109 179 120 171 123 C166 128 157 126 152 123 C146 128 136 126 132 120Z" fill="#FFFDFE" />
            <path d="M127 114 Q130 120 136 116 Q143 124 151 119 Q160 125 168 118 Q173 119 174 113" fill="none" stroke="#D7E9F5" strokeWidth="3.5" />
            <path d="M134 102 Q137 96 143 98 M152 96 Q157 97 159 101" fill="none" stroke="#F5DDEB" strokeWidth="3" />
          </g>
        )}
        {signature === 'chew-bone' && (
          <g data-pet-signature={signature} aria-hidden="true" pointerEvents="none" transform="translate(145 129) rotate(-18)" stroke="#625B68" strokeWidth="2.8" strokeLinejoin="round" strokeLinecap="round">
            <path d="M-10-6 H10 C12-12 18-14 22-10 C27-10 29-3 24 0 C29 3 27 10 22 10 C18 14 12 12 10 6 H-10 C-12 12-18 14-22 10 C-27 10-29 3-24 0 C-29-3-27-10-22-10 C-18-14-12-12-10-6Z" fill="#FFFFFF" />
            <path d="M-9 3 Q0 5 9 3" fill="none" stroke="#E2DFE8" strokeWidth="2.5" />
            <path d="M-20 6 Q-17 9-14 6 M14 6 Q17 9 20 6" fill="none" stroke="#E2DFE8" strokeWidth="2" />
          </g>
        )}
    </>
  );
  return validatePetDesign({ schemaVersion: 1, motionVersion: 1, viewBox: [0, 0, 180, 156], nodes: toDesignNodes(tree) });
}

/** JSX is authoring syntax only; the resulting plain tree is the stored artwork. */
function toDesignNodes(tree: ReactNode): SvgDesignNode[] {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(toDesignNodes);
  if (!isValidElement<Record<string, unknown>>(tree)) throw new Error('Pet designs contain SVG elements only');
  if (tree.type === Fragment) return toDesignNodes(tree.props.children as ReactNode);
  if (typeof tree.type !== 'string') throw new Error('Dynamic components cannot be stored in pet designs');
  const { children, className, ...props } = tree.props;
  const attrs = Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined && value !== null));
  const node: SvgDesignNode = { tag: tree.type as SvgDesignNode['tag'] };
  if (Object.keys(attrs).length) node.attrs = attrs as SvgDesignNode['attrs'];
  const nested = toDesignNodes(children as ReactNode);
  if (nested.length || children !== undefined) node.children = nested;
  if (typeof className === 'string' && className.split(' ').includes('dog-tail')) node.motion = 'tail';
  if (typeof className === 'string' && className.split(' ').includes('dog-tongue')) node.motion = 'tongue';
  return [node];
}
