import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
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

import { APP_TOAST_DURATION, AppToast, DAILY_COMPLETE_TOAST, DAILY_LIMIT_TOAST, DAILY_LIMIT_TOAST_DURATION } from './AppToast';

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
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('centers and auto-dismisses the daily-limit notice', () => {
    vi.useFakeTimers();
    const { onDismissDailyLimit } = setup();
    const toast = screen.getByRole('button');

    expect(toast).toHaveClass('app-toast--centered');
    expect(toast).toHaveClass('app-toast--daily-limit');
    expect(toast).toHaveAttribute('data-duration', String(DAILY_LIMIT_TOAST_DURATION));

    act(() => vi.advanceTimersByTime(DAILY_LIMIT_TOAST_DURATION));
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });

  it('uses the short centered notice for daily completion too', () => {
    vi.useFakeTimers();
    const { onDismissDailyLimit } = setup({ text: DAILY_COMPLETE_TOAST });
    const toast = screen.getByRole('button');

    expect(toast).toHaveClass('app-toast--centered');
    expect(toast).toHaveClass('app-toast--daily-limit');
    expect(toast).toHaveAttribute('data-duration', String(DAILY_LIMIT_TOAST_DURATION));

    act(() => vi.advanceTimersByTime(DAILY_LIMIT_TOAST_DURATION));
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });

  it('centers and auto-dismisses other messages too', () => {
    vi.useFakeTimers();
    const { onDismissDailyLimit } = setup({ text: '사진을 저장했어요.' });
    const toast = screen.getByRole('button');

    expect(toast).toHaveClass('app-toast--centered');
    expect(toast).not.toHaveClass('app-toast--daily-limit');
    expect(toast).toHaveAttribute('data-duration', String(APP_TOAST_DURATION));

    act(() => vi.advanceTimersByTime(APP_TOAST_DURATION - 1));
    expect(onDismissDailyLimit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });

  it('restarts the dismissal timer when the text changes', () => {
    vi.useFakeTimers();
    const onDismissDailyLimit = vi.fn();
    const { rerender } = render(
      <AppToast text="첫 번째 안내" onDismissDailyLimit={onDismissDailyLimit} />,
    );

    act(() => vi.advanceTimersByTime(APP_TOAST_DURATION - 1));
    expect(onDismissDailyLimit).not.toHaveBeenCalled();

    rerender(
      <AppToast text="두 번째 안내" onDismissDailyLimit={onDismissDailyLimit} />,
    );
    expect(screen.getByRole('button')).toHaveTextContent('두 번째 안내');

    act(() => vi.advanceTimersByTime(1));
    expect(onDismissDailyLimit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(APP_TOAST_DURATION - 2));
    expect(onDismissDailyLimit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });

  it('restarts the dismissal timer when the same notice is requested again', () => {
    vi.useFakeTimers();
    const onDismissDailyLimit = vi.fn();
    const { rerender } = render(
      <AppToast text={DAILY_LIMIT_TOAST} eventId={1} onDismissDailyLimit={onDismissDailyLimit} />,
    );

    act(() => vi.advanceTimersByTime(DAILY_LIMIT_TOAST_DURATION - 1));
    rerender(
      <AppToast text={DAILY_LIMIT_TOAST} eventId={2} onDismissDailyLimit={onDismissDailyLimit} />,
    );

    act(() => vi.advanceTimersByTime(1));
    expect(onDismissDailyLimit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(DAILY_LIMIT_TOAST_DURATION - 1));
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });

  it('dismisses one toast event only once when TDS and the fallback timer both finish', () => {
    vi.useFakeTimers();
    const { onDismissDailyLimit } = setup({ text: '사진을 저장했어요.' });
    const toast = screen.getByRole('button');

    act(() => vi.advanceTimersByTime(APP_TOAST_DURATION));
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();

    fireEvent.click(toast);
    expect(onDismissDailyLimit).toHaveBeenCalledOnce();
  });
});
