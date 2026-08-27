import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './tds-mobile';

describe('web-preview Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onClose after its duration', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast position="bottom" open text="안내" duration={2_800} onClose={onClose} />);

    act(() => vi.advanceTimersByTime(2_799));
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not start a timer without an onClose handler', () => {
    vi.useFakeTimers();
    render(<Toast position="bottom" open text="유지되는 안내" duration={2_800} />);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the toast mounted during its downward exit animation', () => {
    vi.useFakeTimers();
    const onExited = vi.fn();
    const { rerender } = render(<Toast position="bottom" open text="안내" onExited={onExited} />);

    rerender(<Toast position="bottom" open={false} text="안내" onExited={onExited} />);
    expect(screen.getByRole('status')).toHaveClass('is-closing');

    act(() => vi.advanceTimersByTime(179));
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onExited).toHaveBeenCalledOnce();
  });
});
