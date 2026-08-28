import { useEffect } from 'react';
import { Toast } from '@toss/tds-mobile';

export const DAILY_LIMIT_TOAST_DURATION = 2_800;
export const APP_TOAST_DURATION = 3_000;
export const DAILY_LIMIT_TOAST = '이용권이 다시 차고 있어요\n3시간마다 한 마리씩 충전돼요';

export function isDailyLimitToast(text: string) {
  return text === DAILY_LIMIT_TOAST;
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
  // TDS restarts its internal timer when `duration` changes. Alternating by a
  // harmless 1ms lets the same message restart without remounting its portal
  // (a keyed remount briefly leaves two animated toast layers behind).
  const tdsDuration = duration + (eventId % 2);

  // TDS also owns a dismissal timer, but keeping the controlled `open` state on
  // an app timer prevents a stale native/WebView animation from leaving the
  // gray notice mounted over the bottom interaction area.
  useEffect(() => {
    if (!text) return undefined;
    const timer = window.setTimeout(onDismissDailyLimit, duration);
    return () => window.clearTimeout(timer);
  }, [duration, eventId, onDismissDailyLimit, text]);

  return (
    <Toast
      className={`app-toast app-toast--centered${isDailyLimit ? ' app-toast--daily-limit' : ''}`}
      position="bottom"
      open={Boolean(text)}
      text={text}
      aria-live={ariaLive}
      duration={tdsDuration}
      onClose={onDismissDailyLimit}
    />
  );
}
