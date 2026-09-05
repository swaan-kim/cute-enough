export type EarShape = 'floppy' | 'upright' | 'semi' | 'rounded';
export type HeadShape = 'round' | 'oval' | 'long';
export type MarkingPattern = 'none' | 'brow' | 'mask' | 'blaze' | 'spots';
export type CoatColor = 'cream' | 'caramel' | 'chocolate' | 'black' | 'gray' | 'white';
export type BrowStyle = 'none' | 'soft' | 'caterpillar' | 'angled';
export type TongueShape = 'drop' | 'round' | 'wide' | 'side';
export type CoatMode = 'solid' | 'point';
export type FurStyle = 'neat' | 'fluffy' | 'cloud';
export type PetStatus = 'pending' | 'approved' | 'rejected' | 'paused' | 'deleted';
export type PetAccessoryKind = 'ribbon' | 'scarf' | 'vest' | 'ball';
export type PetAccessoryColor = 'pink' | 'sky' | 'yellow' | 'mint';
export type AccessorySelectionMode = 'owner' | 'reviewer';

export interface PetAccessory {
  kind: PetAccessoryKind;
  color: PetAccessoryColor;
  /** 현재는 검수된 내장 소품만 허용하며, 전용 소품이 추가될 때 같은 키로 버전을 고정해요. */
  assetKey: string;
}

export interface PetExpression {
  browStyle: BrowStyle;
  tongueShape: TongueShape;
}

export interface PetStyleV1 {
  schemaVersion: 1;
  coatMode: CoatMode;
  furStyle: FurStyle;
  /** 검수 전에는 비워 두고 강아지 ID 기반 표정을 사용할 수 있어요. */
  expression?: PetExpression;
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
  /** 서버가 소유권과 활성 원본을 확인해 소유자 전용 사진 열람을 허용했는지 여부. */
  ownerPhotoAvailable?: boolean;
  /** 소유자의 집에서 우선 보여줄 강아지인지 여부. */
  ownerPinned?: boolean;
  approvalStatus?: PetStatus;
  shareable?: boolean;
  /** 서버가 결정한 무료 재열람 만료 시각. 이 시각 전에만 사진을 바로 다시 열 수 있다. */
  revisitUntil?: string;
  /** `revisitUntil`을 보내지 않는 구버전 서버/미리보기 데이터만을 위한 하위 호환 표시. */
  revealedToday?: boolean;
  /** 검수 전에는 사용자가 확정한 소품, 승인 후에는 검수된 최종 소품이에요. */
  publishedAccessory?: PetAccessory;
  /** 검수 전에는 사용자 초안, 승인 후에는 검수자가 확정한 스타일이에요. */
  publishedStyle?: PetStyleV1;
  /** 승인 결과가 바뀌었을 때 기존 캐릭터 캐시를 무효화하는 단조 증가 버전이에요. */
  designVersion?: number;
  /** API v2가 고정한 오늘의 공개견 슬롯(1~4). */
  houseSlot?: number;
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
  /** 서버가 허용한 KST 하루 보상형 광고 횟수. 구버전 응답은 앱 기본값 2를 사용한다. */
  rewardedLimit?: number;
  /** 서버가 계산한 오늘 남은 보상형 광고 횟수. */
  rewardedRemaining?: number;
  /** 친구 초대로 적립한 보너스. 무료 2개 한도와 자연 충전에서 분리한다. */
  bonusTickets?: number;
  uploadCredit: boolean;
  uploadUsed: boolean;
  /** 업로드 보상으로만 무료 공개할 수 있는 강아지. */
  uploadRewardPetId?: string;
}

export type UnlockMethod = 'FREE' | 'REWARDED' | 'UPLOAD' | 'SHARE';

export interface RewardCapabilities {
  ads: boolean;
  share: boolean;
  notifications?: boolean;
}

export interface AdRewardCredit {
  sessionId: string;
  petId: string;
  canRebind?: boolean;
}

export interface RewardStatus {
  allowance: DailyAllowance;
  capabilities: RewardCapabilities;
  adCredits: AdRewardCredit[];
  serverNow?: string;
}

export interface RewardSessionResult extends RewardStatus {
  sessionId: string;
}

export interface ShareCloseSummary {
  sentRewardsCount: number;
  sentRewardAmount?: number;
  rewardUnit?: string;
}

export interface ShareRewardResult extends RewardStatus {
  reconciliationRequired?: boolean;
}

export interface RevealResult {
  photoUrl: string;
  signedUrlExpiresAt: string;
  /** 서버가 결정한 이 사진의 무료 재열람 만료 시각. */
  revisitUntil?: string;
  allowance: DailyAllowance;
  /** API v2에서는 사진 접근 기록까지 반영된 오늘의 공개견 진행도를 함께 돌려준다. */
  dailyProgress?: DailyProgress;
}

/** 소유자 전용 사진은 이용권이나 재열람 기록을 변경하지 않는다. */
export interface OwnerPhotoResult {
  photoUrl: string;
  signedUrlExpiresAt: string;
  ownerPhotoAvailable: true;
}

export interface DailyProgress {
  date: string;
  metPetIds: string[];
  metCount: number;
  totalCount: number;
  completed: boolean;
}

export interface HouseResult {
  rewardStatus?: RewardStatus;
  serverNow?: string;
  /** 구버전 화면과 테스트를 위한 평탄화 목록. API v2에서는 dailyPets와 동일하다. */
  pets: PetSummary[];
  /** KST 날짜 동안 순서와 구성이 고정되는 공개 강아지(최대 4마리). */
  dailyPets?: PetSummary[];
  /** 공개 4마리와 진행도·이용권에서 완전히 분리된 내 최신 강아지(최대 다섯 번째). */
  ownerBonusPet?: PetSummary;
  allowance?: DailyAllowance;
  dailyProgress?: DailyProgress;
}

export interface SharedPetResult {
  rewardStatus?: RewardStatus;
  serverNow?: string;
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
