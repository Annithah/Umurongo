import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../lib/api';
import { REORDER_REASONS, ReorderDialog } from './ReasonDialog';

const ticket = { number: 'OPD-021', displayName: 'Joy' };

describe('ReorderDialog', () => {
  it('cannot be confirmed without a reason of at least 3 characters', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ReorderDialog ticket={ticket} direction="UP" onConfirm={onConfirm} onClose={() => undefined} />);

    expect(screen.getByRole('dialog', { name: 'Move OPD-021 up' })).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Move up' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), '  ok ');
    expect(confirm).toBeDisabled(); // "ok" is too short once trimmed
    await user.type(screen.getByLabelText(/Reason/), 'ay');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('ok ay');
  });

  it('sends the trimmed reason and closes', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ReorderDialog ticket={ticket} direction="DOWN" onConfirm={onConfirm} onClose={onClose} />);
    await user.type(screen.getByLabelText(/Reason/), '   Stepped out to the toilet   ');
    await user.click(screen.getByRole('button', { name: 'Move down' }));
    expect(onConfirm).toHaveBeenCalledWith('Stepped out to the toilet');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('fills the reason from a suggestion', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ReorderDialog ticket={ticket} direction="UP" onConfirm={onConfirm} onClose={() => undefined} />);
    await user.click(screen.getByRole('button', { name: REORDER_REASONS[0] }));
    expect(screen.getByLabelText(/Reason/)).toHaveValue(REORDER_REASONS[0]);
    await user.click(screen.getByRole('button', { name: 'Move up' }));
    expect(onConfirm).toHaveBeenCalledWith(REORDER_REASONS[0]);
  });

  it('shows the server error and stays open', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn().mockRejectedValue(new ApiError(409, 'OPD-021 is already first in its priority group'));
    render(<ReorderDialog ticket={ticket} direction="UP" onConfirm={onConfirm} onClose={onClose} />);
    await user.type(screen.getByLabelText(/Reason/), 'Very weak');
    await user.click(screen.getByRole('button', { name: 'Move up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already first in its priority group');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Move up' })).toBeEnabled();
  });

  it('closes with Cancel or Escape without confirming', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ReorderDialog ticket={ticket} direction="UP" onConfirm={onConfirm} onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing without a ticket', () => {
    render(<ReorderDialog ticket={null} direction="UP" onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
