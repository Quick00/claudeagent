import { describe, expect, test } from '@jest/globals';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import NoAccessCard, { APOLOGY_URL } from '@/components/NoAccessCard';

describe('NoAccessCard', () => {
  test('tells the account it disrespected the LGD agent', () => {
    renderWithProviders(<NoAccessCard />);
    expect(screen.getByRole('heading', { name: /don.t disrespect the LGD agent/i })).toBeTruthy();
  });

  test('sends the apology somewhere appropriate, in a new tab', () => {
    renderWithProviders(<NoAccessCard />);
    const link = screen.getByRole('link', { name: 'Submit an apology' });
    expect(link.getAttribute('href')).toBe(APOLOGY_URL);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  test('offers a way to sign out', () => {
    renderWithProviders(<NoAccessCard />);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
