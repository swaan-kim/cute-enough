export type EarShape = 'floppy' | 'upright' | 'semi' | 'rounded';
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
  /** 웹 미리보기에서만 쓰는 실사 묶음. 운영에서는 서버가 한 장을 골라 서명 URL만 반환해요. */
  photoUrls?: string[];
  /** 비공개 실사를 직접 내려주지 않는 운영 목록에서 서버가 확인한 사진 보유 여부. */
  photoAvailable?: boolean;
  /** 전달받은 캐릭터 이미지 또는 CDN URL. 없으면 trait 기반 SVG가 표시돼요. */
  illustrationUrl?: string;
  /** 현재 이 화면을 보는 사용자가 등록한 강아지인지 여부. */
  isMine?: boolean;
  /** 소유자의 집에서 우선 보여줄 강아지인지 여부. */
  ownerPinned?: boolean;
  approvalStatus?: PetStatus;
  shareable?: boolean;
  /** 오늘 이미 실제 사진을 본 강아지인지 여부. */
  revealedToday?: boolean;
}

export interface OwnedPetSummary extends PetSummary {
  approvalStatus: PetStatus;
  createdAt?: string;
  rejectionReason?: string;
}

export interface DailyAllowance {
  /** 오늘의 강아지 목록을 고정하는 KST 날짜. 무료 이용권 충전 주기와는 별개다. */
  date: string;
  /**
   * 구버전 클라이언트 호환 값. 현재는 `2 - remaining`으로 계산하며
   * 자정 초기화가 아니라 3시간 충전 상태를 나타낸다.
   */
  freeUsed: number;
  /** 지금 사용할 수 있는 기본 이용권. 최대 2개다. */
  remaining?: number;
  /** 이용권이 2개보다 적을 때 다음 1개가 충전되는 시각. */
  nextChargeAt?: string;
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

export type SubmissionStatusResult =
  | { found: true; result: SubmitPetResult }
  | { found: false };

export type AppScreen = 'home' | 'mine' | 'shared' | 'play' | 'upload' | 'submitted';

export type AppRoute =
  | { screen: 'home' }
  | { screen: 'mine' }
  | { screen: 'shared'; petId: string }
  | { screen: 'play'; petId: string }
  | { screen: 'upload' }
  | { screen: 'submitted' };
