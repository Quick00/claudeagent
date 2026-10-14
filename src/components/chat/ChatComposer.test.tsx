import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { renderWithProviders } from '@/test/render';
import { ChatComposer } from './ChatComposer';

const mockFetch = jest.fn<(input: string, init?: RequestInit) => Promise<unknown>>();
global.fetch = mockFetch as unknown as typeof fetch;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function attach(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  // fireEvent rather than user.upload: the latter drops files the `accept` list excludes,
  // which would hide the composer's own check for files dropped or pasted in.
  fireEvent.change(input, { target: { files } });
}

afterEach(() => {
  mockFetch.mockReset();
  jest.restoreAllMocks();
});

describe('ChatComposer attachments', () => {
  test('a PDF and a workbook upload and go out with the server-detected types', async () => {
    mockFetch.mockImplementation(async (_input, init) => {
      const file = (init?.body as FormData).get('file') as File;
      const mimeType = file.name.endsWith('.pdf') ? 'application/pdf' : XLSX_MIME;
      return { ok: true, json: async () => ({ id: `id-${file.name}`, filename: file.name, mimeType, size: file.size }) };
    });
    const onSend = jest.fn();
    const { container, user } = renderWithProviders(<ChatComposer onSend={onSend} disabled={false} />);

    attach(container, [
      new File(['%PDF-1.7'], 'Manual.pdf', { type: 'application/pdf' }),
      new File(['PK'], 'Budget.xlsx', { type: '' }),
    ]);

    expect(screen.getByText('Manual.pdf')).toBeInTheDocument();
    expect(screen.getByText('Budget.xlsx')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(onSend).toHaveBeenCalledWith('Please look at the attached file(s).', [
      { id: 'id-Manual.pdf', filename: 'Manual.pdf', mimeType: 'application/pdf', size: 8 },
      { id: 'id-Budget.xlsx', filename: 'Budget.xlsx', mimeType: XLSX_MIME, size: 2 },
    ]);
    expect(screen.queryByText('Manual.pdf')).not.toBeInTheDocument();
  });

  test('an unsupported file is refused with a toast and never queued', () => {
    const toastError = jest.spyOn(toast, 'error').mockReturnValue('');
    const { container } = renderWithProviders(<ChatComposer onSend={jest.fn()} disabled={false} />);

    attach(container, [new File(['x'], 'Slides.pptx')]);

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("Slides.pptx can't be attached"));
    expect(screen.queryByText('Slides.pptx')).not.toBeInTheDocument();
  });

  test("the server's reason for refusing a file is shown and nothing is sent", async () => {
    const toastError = jest.spyOn(toast, 'error').mockReturnValue('');
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Could not read Budget.xlsx. It may be damaged or password-protected.' }),
    });
    const onSend = jest.fn();
    const { container, user } = renderWithProviders(<ChatComposer onSend={onSend} disabled={false} />);

    attach(container, [new File(['PK'], 'Budget.xlsx')]);
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Could not read Budget.xlsx. It may be damaged or password-protected.'),
    );
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText('Budget.xlsx')).toBeInTheDocument();
  });
});
