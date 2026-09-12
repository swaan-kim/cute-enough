import { useCallback, useEffect, useRef } from 'react';
import { Toast } from '@toss/tds-mobile';

export const DAILY_LIMIT_TOAST_DURATION = 2_800;
export const APP_TOAST_DURATION = 3_000;
export const DAILY_LIMIT_TOAST = '티켓이 다시 차고 있어요\n3시간마다 한 장씩 충전돼요';
export const DAILY_COMPLETE_TOAST = '오늘의 네 친구를 모두 만났어요\n내일 다시 만나요';

export function isDailyLimitToast(text: string) {
  return text === DAILY_LIMIT_TOAST || text === DAILY_COMPLETE_TOAST;
}

type AppToastProps = {
  text: string;
  eventId?: number;
  onDismissDailyLimit: () => void;
  ariaLive?: 'polite' | 'assertive';
};

export function AppToast({ text, eventId = 0, onDismissDailyLimit, ariaLive = 'polite' }: AppToastProps) {
  const isDailyLimit = isDailyLimitToast(text);
  const duration = isDailyLimit ? DAILY_LIMIT_TOAST_DURATION : APP_TOAST_DURATION;
  const eventKey = `${eventId}:${text}`;
  const currentEventRef = useRef(eventKey);
  const dismissedEventRef = useRef<string>();
  const dismissRef = useRef(onDismissDailyLimit);
  currentEventRef.current = eventKey;
  dismissRef.current = onDismissDailyLimit;

  const dismissCurrent = useCallback(() => {
    // TDS and the app fallback timer can finish at almost the same time. Only
    // the current toast event may close the controlled root toast, and it may
    // do so once. This also keeps a previous screen's closing animation from
    // dismissing a newer notice after navigation.
    if (!text || currentEventRef.current !== eventKey || dismissedEventRef.current === eventKey) return;
    dismissedEventRef.current = eventKey;
    dismissRef.current();
  }, [eventKey, text]);

  // TDS restarts its internal timer when `duration` changes. Alternating by a
  // harmless 1ms lets the same message restart without remounting its portal
  // (a keyed remount briefly leaves two animated toast layers behind).
  const tdsDuration = duration + (eventId % 2);

  // TDS also owns a dismissal timer, but keeping the controlled `open` state on
  // an app timer prevents a stale native/WebView animation from leaving the
  // gray notice mounted over the bottom interaction area.
  useEffect(() => {
    if (!text) return undefined;
    dismissedEventRef.current = undefined;
    const timer = window.setTimeout(dismissCurrent, duration);
    return () => window.clearTimeout(timer);
  }, [dismissCurrent, duration, eventId, text]);

  return (
    <Toast
      className={`app-toast app-toast--centered${isDailyLimit ? ' app-toast--daily-limit' : ''}`}
      position="bottom"
      open={Boolean(text)}
      text={text}
      aria-live={ariaLive}
      duration={tdsDuration}
      onClose={dismissCurrent}
    />
  );
}
