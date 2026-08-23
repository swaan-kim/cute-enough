import type { PetExpression, PetTraitsV1 } from '../types';

const COLORS: Record<PetTraitsV1['baseColor'], string> = {
  cream: '#F6DEB3', caramel: '#C98955', chocolate: '#714536', black: '#3C3B41', gray: '#A8A6AE', white: '#FFFDF8',
};

interface Props {
  traits: PetTraitsV1;
  expression?: PetExpression;
  name?: string;
  active?: boolean;
  eating?: boolean;
  panting?: boolean;
  happy?: boolean;
  size?: number;
}

export function DogAvatar({ traits, expression = { browStyle: 'none', tongueShape: 'drop' }, name, active = false, eating = false, panting = false, happy = false, size = 150 }: Props) {
  const base = COLORS[traits.baseColor];
  const secondary = COLORS[traits.secondaryColor];
  const upright = traits.earShape === 'upright';
  const floppy = traits.earShape === 'floppy';
  const headRx = traits.headShape === 'long' ? 61 : traits.headShape === 'oval' ? 68 : 74;
  return (
    <div className={`dog-avatar ${active ? 'is-active' : ''} ${eating ? 'is-eating' : ''} ${panting ? 'is-panting' : ''} ${happy ? 'is-happy' : ''}`} style={{ width: size }} aria-label={name ? `${name} 강아지` : '강아지'}>
      <svg viewBox="0 0 180 156" role="img" aria-hidden="true">
        <g className="dog-tail"><path d="M145 112c25-9 29-25 18-29-10-4-14 8-8 15" fill="none" stroke="#25222A" strokeWidth="7" strokeLinecap="round" /></g>
        <ellipse cx="90" cy="123" rx="59" ry="22" fill={base} stroke="#25222A" strokeWidth="5" />
        <path d={upright ? 'M40 60 L36 12 Q58 20 71 45Z' : floppy ? 'M54 49 Q25 37 27 78 Q31 96 53 81Z' : 'M54 49 Q30 20 32 72 Q36 83 55 72Z'} fill={secondary} stroke="#25222A" strokeWidth="5" strokeLinejoin="round" />
        <path d={upright ? 'M140 60 L144 12 Q122 20 109 45Z' : floppy ? 'M126 49 Q155 37 153 78 Q149 96 127 81Z' : 'M126 49 Q150 20 148 72 Q144 83 125 72Z'} fill={secondary} stroke="#25222A" strokeWidth="5" strokeLinejoin="round" />
        <ellipse cx="90" cy="70" rx={headRx} ry="60" fill={base} stroke="#25222A" strokeWidth="5" />
        {traits.markingPattern === 'blaze' && <path d="M82 13 Q96 42 87 68 Q79 43 82 13" fill={secondary} opacity=".95" />}
        {traits.markingPattern === 'mask' && <path d="M33 54 Q48 28 73 40 L67 72 Q43 80 33 54M147 54 Q132 28 107 40 L113 72 Q137 80 147 54" fill={secondary} opacity=".9" />}
        {traits.markingPattern === 'brow' && <><ellipse cx="61" cy="43" rx="11" ry="7" fill={secondary} /><ellipse cx="119" cy="43" rx="11" ry="7" fill={secondary} /></>}
        {traits.markingPattern === 'spots' && <><circle cx="53" cy="39" r="13" fill={secondary} /><circle cx="126" cy="83" r="10" fill={secondary} /></>}
        {expression.browStyle !== 'none' && (
          <g className={`dog-brows dog-brows--${expression.browStyle}`} data-brow-style={expression.browStyle} fill="none" stroke="#3B2A22" strokeLinecap="round">
            {expression.browStyle === 'soft' && <><path d="M54 49 Q61 45 68 49" strokeWidth="4" /><path d="M112 49 Q119 45 126 49" strokeWidth="4" /></>}
            {expression.browStyle === 'caterpillar' && <><path d="M52 48 Q56 43 61 47 Q66 42 70 48" strokeWidth="6" /><path d="M110 48 Q114 42 119 47 Q124 43 128 48" strokeWidth="6" /></>}
            {expression.browStyle === 'angled' && <><path d="M53 44 L68 50" strokeWidth="5" /><path d="M112 50 L127 44" strokeWidth="5" /></>}
          </g>
        )}
        <circle cx="65" cy="65" r="5.5" fill="#25222A" /><circle cx="115" cy="65" r="5.5" fill="#25222A" />
        <ellipse cx="90" cy="88" rx={traits.muzzle === 'long' ? 29 : 24} ry="20" fill={secondary} stroke="#25222A" strokeWidth="3.5" />
        <path d="M83 82 Q90 76 97 82 Q95 91 90 91 Q85 91 83 82" fill="#27242A" />
        <path d="M90 91 L90 98 M90 98 Q82 105 77 98 M90 98 Q98 105 103 98" fill="none" stroke="#25222A" strokeWidth="3.5" strokeLinecap="round" />
        <g className={`dog-tongue dog-tongue--${expression.tongueShape}`} data-tongue-shape={expression.tongueShape}>
          {expression.tongueShape === 'drop' && <path d="M86 100 Q90 113 94 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
          {expression.tongueShape === 'round' && <path d="M85 100 C85 108 87 114 90 114 C93 114 95 108 95 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
          {expression.tongueShape === 'wide' && <path d="M83 100 C83 108 86 113 90 113 C94 113 97 108 97 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
          {expression.tongueShape === 'side' && <path d="M88 100 C91 102 97 103 98 107 C100 111 98 114 95 113 C92 112 90 106 88 100Z" fill="#FF8FA3" stroke="#25222A" strokeWidth="3" />}
        </g>
        <path d="M50 128v15M130 128v15" stroke="#25222A" strokeWidth="7" strokeLinecap="round" />
      </svg>
      {name && <span className="dog-name">{name}</span>}
    </div>
  );
}
