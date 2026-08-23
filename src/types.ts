export type EarShape = 'floppy' | 'upright' | 'semi';
export type HeadShape = 'round' | 'oval' | 'long';
export type MarkingPattern = 'none' | 'brow' | 'mask' | 'blaze' | 'spots';
export type CoatColor = 'cream' | 'caramel' | 'chocolate' | 'black' | 'gray' | 'white';

export interface PetTraitsV1 {
  schemaVersion: 1;
  earShape: EarShape;
  headShape: HeadShape;
  baseColor: CoatColor;
  secondaryColor: CoatColor;
  markingPattern: MarkingPattern;
  muzzle: 'short' | 'medium' | 'long';
  confidence: number;
}

export interface PetSummary {
  id: string;
  name?: string;
  traits: PetTraitsV1;
  photoUrl?: string;
  /** 전달받은 캐릭터 이미지 또는 CDN URL. 없으면 trait 기반 SVG가 표시돼요. */
  illustrationUrl?: string;
  ownerPinned?: boolean;
}

export interface DailyAllowance {
  date: string;
  freeUsed: boolean;
  rewardedUsed: number;
  uploadCredit: boolean;
  uploadUsed: boolean;
}

export type UnlockMethod = 'FREE' | 'REWARDED' | 'UPLOAD';

export interface RevealResult {
  photoUrl: string;
  signedUrlExpiresAt: string;
  allowance: DailyAllowance;
}

export type AppScreen = 'home' | 'play' | 'upload' | 'submitted';
