import { describe, expect, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialogProvider, useConfirm } from './use-confirm';

function Subject({ onResult }: { onResult: (ok: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () => {
        onResult(
          await confirm({
            title: 'Delete conversation?',
            description: 'This cannot be undone.',
            confirmLabel: 'Delete',
          }),
        );
      }}
    >
      Delete
    </button>
  );
}

function setup(onResult: (ok: boolean) => void) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <ConfirmDialogProvider>
      <Subject onResult={onResult} />
    </ConfirmDialogProvider>,
  );
  return user;
}

describe('useConfirm', () => {
  test('shows the title and description passed to confirm()', async () => {
    const user = setup(() => {});
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Delete conversation?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  test('resolves true when the confirm action is chosen', async () => {
    const results: boolean[] = [];
    const user = setup((ok) => results.push(ok));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Delete', hidden: false }));

    await waitFor(() => expect(results).toEqual([true]));
  });

  test('resolves false when cancelled', async () => {
    const results: boolean[] = [];
    const user = setup((ok) => results.push(ok));

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(results).toEqual([false]));
  });

  test('renders nothing until confirm() is called', () => {
    setup(() => {});
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
