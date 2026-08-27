import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@toss/tds-mobile', () => ({
  Toast: ({ className, duration, onClose, open, text }: {
    className?: string;
    duration?: number;
    onClose?: () => void;
    open: boolean;
    text: string;
  }) => open ? (
    <button
      className={className}
      data-duration={duration}
      onClick={onClose}
      type="button"
    >
      {text}
    </button>
  ) : null,
}));

import { APP_TOAST_DURATION, AppToast, DAILY_LIMIT_TOAST, DAILY_LIMIT_TOAST_DURATION } from './AppToast';

type Props = ComponentProps<typeof AppToast>;

function setup(props: Partial<Props> = {}) {
  const onDismissDailyLimit = vi.fn();
  render(
    <AppToast
      text={DAILY_LIMIT_TOAST}
      onDismissDailyLimit={onDismissDailyLimit}
      {...props}
    />,
  );
  return { onDismissDailyLimit };
}

describe('AppToast', () => {
  it('centers and auto-dismisses the daily-limit notice', () => {
    const { onDismissDailyLimit } = setup();
    const toast = screen.getByRole('button');

    expect(toast).toHaveClass('app-toast--centered');
    expect(toast).toHaveClass('app-toast--daily-limit');
    expect(toast).toHaveAttribute('data-duration', String(DAILY_LIMIT_TOAST_DURATION));

    fireEvent.click(toast);
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });

  it('centers and auto-dismisses other messages too', () => {
    const { onDismissDailyLimit } = setup({ text: '사진을 저장했어요.' });
    const toast = screen.getByRole('button');

    expect(toast).toHaveClass('app-toast--centered');
    expect(toast).not.toHaveClass('app-toast--daily-limit');
    expect(toast).toHaveAttribute('data-duration', String(APP_TOAST_DURATION));

    fireEvent.click(toast);
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });
});
