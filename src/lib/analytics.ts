import { Analytics } from '@apps-in-toss/web-framework';

type AnalyticsValue = string | number | boolean | null | undefined;

/**
 * 이름·사진·강아지 ID 같은 사용자 데이터를 받지 않는 제품 이벤트 전용 래퍼.
 * QR/샌드박스에서는 SDK가 전송하지 않고, 미지원 토스 버전에서도 조용히 무시한다.
 */
export function trackProductEvent(
  logName: string,
  params: Record<string, AnalyticsValue> = {},
): void {
  void Analytics.log({
    log_type: 'event',
    log_name: logName,
    params,
  }).catch(() => undefined);
}
