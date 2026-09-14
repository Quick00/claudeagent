import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import AdminSettings from './AdminSettings';

type FetchCall = [string, RequestInit | undefined];

describe('AdminSettings', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({ requireUserApproval: false, knowledgeIgnorePatterns: 'node_modules/' }),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  test('toggling the approval switch PATCHes /api/admin/settings with the new value', async () => {
    const { user } = renderWithProviders(<AdminSettings />);

    const toggle = await screen.findByRole('switch', { name: 'Require approval for new accounts' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    await user.click(toggle);

    await waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as FetchCall[];
      expect(calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
    });

    const calls = fetchMock.mock.calls as unknown as FetchCall[];
    const [url, init] = calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(url).toBe('/api/admin/settings');
    expect(init?.body).toBe(JSON.stringify({ requireUserApproval: true }));

    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  test('loads the ignore patterns into the textarea', async () => {
    renderWithProviders(<AdminSettings />);

    expect(await screen.findByRole('textbox')).toHaveValue('node_modules/');
  });
});
