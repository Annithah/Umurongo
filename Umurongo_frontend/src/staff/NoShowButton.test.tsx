import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NoShowButton from './NoShowButton';

const NOW = new Date('2026-11-18T08:00:00Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString();

describe('NoShowButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('is disabled with a countdown until 10 minutes after the call', () => {
    render(<NoShowButton calledAt={ago(9 * 60 + 55)} graceMinutes={10} ticketNumber="OPD-024" onConfirm={vi.fn()} />);
    const button = screen.getByRole('button', { name: /No-show in 0:05/ });
    expect(button).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('button', { name: /No-show in 0:02/ })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'No-show' })).toBeEnabled();
  });

  it('counts down from the full grace period right after the call', () => {
    render(<NoShowButton calledAt={ago(0)} graceMinutes={10} ticketNumber="OPD-024" onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: /No-show in 10:00/ })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole('button', { name: /No-show in 8:59/ })).toBeDisabled();
  });

  it('uses the hospital grace period', () => {
    render(<NoShowButton calledAt={ago(3 * 60)} graceMinutes={3} ticketNumber="OPD-024" onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'No-show' })).toBeEnabled();
  });

  it('asks for confirmation in an in-app dialog before marking', () => {
    const onConfirm = vi.fn();
    render(<NoShowButton calledAt={ago(11 * 60)} graceMinutes={10} ticketNumber="OPD-024" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'No-show' }));
    expect(screen.getByRole('dialog', { name: 'Mark OPD-024 as no-show?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'No-show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark no-show' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cannot be clicked while waiting even if the click is forced', () => {
    const onConfirm = vi.fn();
    render(<NoShowButton calledAt={ago(60)} graceMinutes={10} ticketNumber="OPD-024" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /No-show in/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
