import { Toast } from '@toss/tds-mobile';

export const DAILY_LIMIT_TOAST_DURATION = 2_800;
export const APP_TOAST_DURATION = 3_000;
export const DAILY_LIMIT_TOAST = '이용권이 다시 차고 있어요\n3시간마다 한 마리씩 충전돼요';

export function isDailyLimitToast(text: string) {
  return text === DAILY_LIMIT_TOAST;
}

type AppToastProps = {
  text: string;
  onDismissDailyLimit: () => void;
  ariaLive?: 'polite' | 'assertive';
};

export function AppToast({ text, onDismissDailyLimit, ariaLive = 'polite' }: AppToastProps) {
  const isDailyLimit = isDailyLimitToast(text);

  return (
    <Toast
      className={`app-toast app-toast--centered${isDailyLimit ? ' app-toast--daily-limit' : ''}`}
      position="bottom"
      open={Boolean(text)}
      text={text}
      aria-live={ariaLive}
      duration={isDailyLimit ? DAILY_LIMIT_TOAST_DURATION : APP_TOAST_DURATION}
      onClose={onDismissDailyLimit}
    />
  );
}
