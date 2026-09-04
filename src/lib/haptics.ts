import { Device, type HapticFeedbackType } from '@apps-in-toss/web-framework';

export type HapticCue =
  | 'friendsArrived'
  | 'dragStart'
  | 'treatSuccess'
  | 'pet'
  | 'photoReveal'
  | 'photoHeart'
  | 'uploadSuccess';

const HAPTIC_TYPES: Readonly<Record<HapticCue, HapticFeedbackType>> = {
  friendsArrived: 'tickWeak',
  dragStart: 'tickWeak',
  treatSuccess: 'softMedium',
  pet: 'tickWeak',
  photoReveal: 'success',
  photoHeart: 'tickWeak',
  uploadSuccess: 'success',
};

/** 햅틱은 보조 피드백이므로 브릿지 실패가 핵심 흐름을 막지 않게 한다. */
export async function playHaptic(cue: HapticCue): Promise<void> {
  try {
    await Device.triggerHaptic({ type: HAPTIC_TYPES[cue] });
  } catch {
    // 브라우저 미리보기, 미지원 기기, 시스템 진동 끔 상태에서도 앱은 그대로 동작한다.
  }
}
