import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { setMockSession } from '@/test/mocks/next-auth-react';

// TipTap builds a real ProseMirror EditorView on mount, which is fragile
// under jsdom (see track-4 brief). We mock the React binding with a plain
// textarea that round-trips through the same `onUpdate({ editor })` shape
// the real component reads from, so FeedbackModal's own state wiring
// (title/description/submit) is exercised for real.
jest.mock('@tiptap/react', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');

  function chain(): Record<string, () => unknown> {
    const c: Record<string, () => unknown> = {};
    ['focus', 'toggleBold', 'toggleItalic', 'toggleBulletList', 'extendMarkRange', 'setLink', 'unsetLink'].forEach(
      (method) => {
        c[method] = () => c;
      },
    );
    c.run = () => undefined;
    return c;
  }

  return {
    useEditor: (config: { onUpdate?: (arg: unknown) => void }) => {
      const editor: Record<string, unknown> = {
        isActive: () => false,
        getAttributes: () => ({ href: '' }),
        chain,
        commands: { clearContent: jest.fn() },
        storage: { markdown: { getMarkdown: () => '' } },
      };
      editor.__onUpdate = config?.onUpdate;
      return editor;
    },
    EditorContent: ({
      editor,
      className,
    }: {
      editor: { storage: { markdown: { getMarkdown: () => string } }; __onUpdate?: (arg: unknown) => void };
      className?: string;
    }) =>
      ReactActual.createElement('textarea', {
        'data-testid': 'description-editor',
        className,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
          const value = e.target.value;
          editor.storage.markdown.getMarkdown = () => value;
          editor.__onUpdate?.({ editor });
        },
      }),
  };
});

// `jest.mock` above is not hoisted in this project's SWC transform (see
// AppShell.test.tsx), so FeedbackModal — which imports `@tiptap/react` — is
// pulled in via `require` after the mock is registered rather than a
// top-level `import`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FeedbackModal = (require('./FeedbackModal') as typeof import('./FeedbackModal')).default;

describe('FeedbackModal', () => {
  beforeEach(() => {
    setMockSession({
      user: { id: 'u1', email: 'user@example.com', role: 'user', status: 'APPROVED' },
      expires: '2999-01-01',
    });
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;
  });

  test('advances through the steps and POSTs the collected payload on submit', async () => {
    const { user } = renderWithProviders(<FeedbackModal />);

    await user.click(screen.getByRole('button', { name: 'Feedback' }));
    await user.click(await screen.findByRole('button', { name: 'Feature Request' }));

    await user.type(screen.getByPlaceholderText('Have something to say?'), 'My idea');
    fireEvent.change(screen.getByTestId('description-editor'), {
      target: { value: 'Please add dark mode' },
    });

    await user.click(screen.getByRole('button', { name: 'Create A New Post' }));

    await waitFor(() => {
      const calls = (global.fetch as jest.Mock).mock.calls as unknown as [string, RequestInit][];
      expect(calls.some(([url]) => url === '/api/feedback')).toBe(true);
    });

    const calls = (global.fetch as jest.Mock).mock.calls as unknown as [string, RequestInit][];
    const [, init] = calls.find(([url]) => url === '/api/feedback')!;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'FEATURE_REQUEST',
      title: 'My idea',
      description: 'Please add dark mode',
    });
  });

  test('shows the thank-you screen after a successful submit', async () => {
    const { user } = renderWithProviders(<FeedbackModal />);

    await user.click(screen.getByRole('button', { name: 'Feedback' }));
    await user.click(await screen.findByRole('button', { name: 'Bug' }));
    await user.type(screen.getByPlaceholderText('Have something to say?'), 'Broken button');
    fireEvent.change(screen.getByTestId('description-editor'), {
      target: { value: 'It does not click' },
    });
    await user.click(screen.getByRole('button', { name: 'Create A New Post' }));

    expect(await screen.findByText('Thank you!')).toBeInTheDocument();
  });

  test('the submit button stays disabled until both title and description are filled', async () => {
    const { user } = renderWithProviders(<FeedbackModal />);

    await user.click(screen.getByRole('button', { name: 'Feedback' }));
    await user.click(await screen.findByRole('button', { name: 'Bug' }));

    expect(screen.getByRole('button', { name: 'Create A New Post' })).toBeDisabled();
  });
});
