export type EarShape = 'floppy' | 'upright' | 'semi';
export type HeadShape = 'round' | 'oval' | 'long';
export type MarkingPattern = 'none' | 'brow' | 'mask' | 'blaze' | 'spots';
export type CoatColor = 'cream' | 'caramel' | 'chocolate' | 'black' | 'gray' | 'white';
export type BrowStyle = 'none' | 'soft' | 'caterpillar' | 'angled';
export type TongueShape = 'drop' | 'round' | 'wide' | 'side';
export type PetStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'deleted';

export interface PetExpression {
  browStyle: BrowStyle;
  tongueShape: TongueShape;
}

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
  approvalStatus?: PetStatus;
  shareable?: boolean;
}

export interface OwnedPetSummary extends PetSummary {
  approvalStatus: PetStatus;
  createdAt?: string;
  rejectionReason?: string;
}

export interface DailyAllowance {
  date: string;
  freeUsed: boolean;
  rewardedUsed: number;
  uploadCredit: boolean;
  uploadUsed: boolean;
  /** 업로드 보상으로만 무료 공개할 수 있는 강아지. */
  uploadRewardPetId?: string;
}

export type UnlockMethod = 'FREE' | 'REWARDED' | 'UPLOAD';

export interface RevealResult {
  photoUrl: string;
  signedUrlExpiresAt: string;
  allowance: DailyAllowance;
}

export interface HouseResult {
  pets: PetSummary[];
  allowance?: DailyAllowance;
}

export interface SharedPetResult {
  pet: PetSummary;
  allowance?: DailyAllowance;
}

export interface SubmitPetResult {
  pet: PetSummary;
  rewardGranted: boolean;
  uploadRewardPetId?: string;
}

export type AppScreen = 'home' | 'mine' | 'shared' | 'play' | 'upload' | 'submitted';

export type AppRoute =
  | { screen: 'home' }
  | { screen: 'mine' }
  | { screen: 'shared'; petId: string }
  | { screen: 'play'; petId: string }
  | { screen: 'upload' }
  | { screen: 'submitted' };
