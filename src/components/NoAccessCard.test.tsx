import { describe, expect, test } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import NoAccessCard, { apologyText } from '@/components/NoAccessCard';

describe('NoAccessCard', () => {
  test('tells the account it disrespected the LGD agent', () => {
    renderWithProviders(<NoAccessCard firstName="Laura" />);
    expect(screen.getByRole('heading', { name: /don.t disrespect the LGD agent/i })).toBeTruthy();
  });

  test('opens an apology addressed by first name, ready to paste in lgd-talks', () => {
    renderWithProviders(<NoAccessCard firstName="Laura" />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit an apology' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Laura, to apologise, copy the text below');
    expect(dialog.textContent).toContain('lgd-talks');
    expect(dialog.textContent).toContain(apologyText('Laura'));
  });

  test('copies the apology', async () => {
    // userEvent.setup() (inside renderWithProviders) installs a readable clipboard stub.
    const { user } = renderWithProviders(<NoAccessCard firstName="Laura" />);
    await user.click(screen.getByRole('button', { name: 'Submit an apology' }));
    await user.click(screen.getByRole('button', { name: 'Copy apology' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy());
    expect(await navigator.clipboard.readText()).toBe(apologyText('Laura'));
  });

  test('offers a way to sign out', () => {
    renderWithProviders(<NoAccessCard firstName="Laura" />);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('apologyText', () => {
  test('starts with "I, <first name>,"', () => {
    expect(apologyText('Laura').startsWith('I, Laura, ')).toBe(true);
  });
});
