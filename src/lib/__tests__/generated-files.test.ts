import { createGeneratedFile, linkGeneratedFiles, discardUnlinkedGeneratedFiles } from '@/lib/generated-files';
import { prisma } from '@/lib/prisma';
import { saveUploadedFile, deleteUploadedFile } from '@/lib/upload';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    message: { findUnique: jest.fn() },
    attachment: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
  },
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
jest.mock('@/lib/upload', () => ({ saveUploadedFile: jest.fn(), deleteUploadedFile: jest.fn() }));

const db = prisma as unknown as {
  message: { findUnique: jest.Mock };
  attachment: { count: jest.Mock; create: jest.Mock; findMany: jest.Mock; updateMany: jest.Mock; deleteMany: jest.Mock };
};
const save = saveUploadedFile as jest.Mock;
const remove = deleteUploadedFile as jest.Mock;

const xlsxInput = { format: 'xlsx', filename: 'Team list', sheets: [{ name: 'People', columns: ['Name'], rows: [['Ann']] }] };

beforeEach(() => {
  jest.clearAllMocks();
  db.message.findUnique.mockResolvedValue({ id: 'm1', conversationId: 'c1', conversation: { userId: 'owner' } });
  db.attachment.count.mockResolvedValue(0);
  save.mockResolvedValue({ storagePath: '/up/c1/f.xlsx', id: 'f' });
  db.attachment.create.mockImplementation(({ data }) => Promise.resolve({ id: 'a1', ...data }));
});

describe('createGeneratedFile', () => {
  it('404s an unknown trigger message', async () => {
    db.message.findUnique.mockResolvedValue(null);
    await expect(createGeneratedFile('nope', xlsxInput)).resolves.toMatchObject({ ok: false, status: 404 });
    expect(save).not.toHaveBeenCalled();
  });

  it('refuses a sixth file in the same turn', async () => {
    db.attachment.count.mockResolvedValue(5);
    const result = await createGeneratedFile('m1', xlsxInput);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(!result.ok && result.error).toMatch(/5/);
    expect(save).not.toHaveBeenCalled();
  });

  it('returns the validator error for bad input', async () => {
    const result = await createGeneratedFile('m1', { format: 'docx', filename: 'x' });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(!result.ok && result.error).toMatch(/xlsx/);
  });

  it('stores an unlinked attachment owned by the conversation owner', async () => {
    const result = await createGeneratedFile('m1', xlsxInput);
    expect(save).toHaveBeenCalledWith(expect.any(Buffer), 'c1', 'xlsx');
    expect(db.attachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId: null,
        uploadedById: 'owner',
        generatedForMessageId: 'm1',
        filename: 'Team list.xlsx',
        storagePath: '/up/c1/f.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    });
    expect(result).toEqual({ ok: true, file: expect.objectContaining({ id: 'a1', filename: 'Team list.xlsx' }) });
  });

  it('removes the stored file when the row cannot be written', async () => {
    db.attachment.create.mockRejectedValue(new Error('db down'));
    await expect(createGeneratedFile('m1', xlsxInput)).rejects.toThrow('db down');
    expect(remove).toHaveBeenCalledWith('/up/c1/f.xlsx');
  });
});

describe('createGeneratedFile builder failure', () => {
  it('returns a 400 Claude can act on when the builder throws', async () => {
    let isolated!: typeof import('@/lib/generated-files');
    jest.isolateModules(() => {
      jest.doMock('@/lib/prisma', () => ({ prisma: db }));
      jest.doMock('@/lib/upload', () => ({ saveUploadedFile: save, deleteUploadedFile: remove }));
      jest.doMock('@/lib/generate-file', () => ({
        ...jest.requireActual('@/lib/generate-file'),
        buildGeneratedFile: jest.fn().mockRejectedValue(new Error('The name "X" is protected')),
      }));
      isolated = require('@/lib/generated-files');
    });
    const result = await isolated.createGeneratedFile('m1', xlsxInput);
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(save).not.toHaveBeenCalled();
  });
});

describe('linkGeneratedFiles', () => {
  it('links nothing when the turn wrote no reply', async () => {
    await expect(linkGeneratedFiles('m1', null)).resolves.toEqual([]);
    expect(db.attachment.updateMany).not.toHaveBeenCalled();
  });

  it('links the turn\'s unlinked files to the reply and returns them', async () => {
    db.attachment.findMany.mockResolvedValue([{ id: 'a1', filename: 'x.pdf', mimeType: 'application/pdf', size: 10 }]);
    const files = await linkGeneratedFiles('m1', 'reply');
    expect(db.attachment.updateMany).toHaveBeenCalledWith({ where: { generatedForMessageId: 'm1', messageId: null }, data: { messageId: 'reply' } });
    expect(db.attachment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { generatedForMessageId: 'm1', messageId: 'reply' } }));
    expect(files).toEqual([{ id: 'a1', filename: 'x.pdf', mimeType: 'application/pdf', size: 10 }]);
  });
});

describe('discardUnlinkedGeneratedFiles', () => {
  it('deletes each unlinked file and its row', async () => {
    db.attachment.findMany.mockResolvedValue([{ id: 'a1', storagePath: '/p/1' }, { id: 'a2', storagePath: '/p/2' }]);
    await discardUnlinkedGeneratedFiles('m1');
    expect(remove).toHaveBeenCalledWith('/p/1');
    expect(remove).toHaveBeenCalledWith('/p/2');
    expect(db.attachment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] } } });
  });
});

describe('attachGeneratedFilesToReply', () => {
  const sink = () => ({ send: jest.fn(), close: jest.fn() });

  it('links the files and tells the client about them', async () => {
    const { attachGeneratedFilesToReply } = jest.requireActual('@/lib/generated-files') as typeof import('@/lib/generated-files');
    const file = { id: 'a1', filename: 'x.pdf', mimeType: 'application/pdf', size: 10 };
    db.attachment.findMany.mockResolvedValue([file]);
    const s = sink();
    await attachGeneratedFilesToReply(s, 'm1', 'reply');
    expect(s.send).toHaveBeenCalledWith(JSON.stringify({ type: 'files', messageId: 'reply', files: [file] }));
  });

  it('sends nothing when the turn made no files', async () => {
    const { attachGeneratedFilesToReply } = jest.requireActual('@/lib/generated-files') as typeof import('@/lib/generated-files');
    db.attachment.findMany.mockResolvedValue([]);
    const s = sink();
    await attachGeneratedFilesToReply(s, 'm1', 'reply');
    expect(s.send).not.toHaveBeenCalled();
  });

  it('never fails the turn when linking throws', async () => {
    const { attachGeneratedFilesToReply } = jest.requireActual('@/lib/generated-files') as typeof import('@/lib/generated-files');
    db.attachment.updateMany.mockRejectedValue(new Error('db down'));
    const s = sink();
    await expect(attachGeneratedFilesToReply(s, 'm1', 'reply')).resolves.toBeUndefined();
    expect(s.send).not.toHaveBeenCalled();
  });
});
