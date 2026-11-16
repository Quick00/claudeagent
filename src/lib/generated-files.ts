import * as Sentry from '@sentry/nextjs';
import { config } from '@/lib/config';
import type { SseSink } from '@/lib/claude-process-stream';
import { prisma } from '@/lib/prisma';
import { saveUploadedFile, deleteUploadedFile } from '@/lib/upload';
import { buildGeneratedFile, generatedFilename, sanitizeGenerateRequest, validateGenerateRequest } from '@/lib/generate-file';

export type GeneratedFileSummary = { id: string; filename: string; mimeType: string; size: number };

type CreateResult = { ok: true; file: GeneratedFileSummary } | { ok: false; status: 400 | 404; error: string };

const summary = { id: true, filename: true, mimeType: true, size: true } as const;

/**
 * Builds a file for the `create_file` tool. It is stored unlinked, owned by the
 * conversation's owner and tagged with the turn's message id; the turn links it
 * to its reply when it finishes (`linkGeneratedFiles`).
 */
export async function createGeneratedFile(triggerMessageId: string, input: unknown): Promise<CreateResult> {
  const trigger = await prisma.message.findUnique({
    where: { id: triggerMessageId },
    select: { id: true, conversationId: true, conversation: { select: { userId: true } } },
  });
  if (!trigger) return { ok: false, status: 404, error: 'This conversation turn could not be found.' };

  const validation = validateGenerateRequest(input);
  if (!validation.ok) return { ok: false, status: 400, error: validation.error };

  const made = await prisma.attachment.count({ where: { generatedForMessageId: triggerMessageId } });
  if (made >= config.generatedFiles.maxPerTurn) {
    return { ok: false, status: 400, error: `At most ${config.generatedFiles.maxPerTurn} files can be created per answer.` };
  }

  const request = sanitizeGenerateRequest(validation.request);
  let built: Awaited<ReturnType<typeof buildGeneratedFile>>;
  try {
    built = await buildGeneratedFile(request);
  } catch (err) {
    Sentry.captureException(err, { extra: { triggerMessageId, format: request.format } });
    return { ok: false, status: 400, error: 'The file could not be built from this content. Try simpler content or a different layout.' };
  }
  const { buffer, mimeType, ext } = built;
  const { storagePath } = await saveUploadedFile(buffer, trigger.conversationId, ext);

  try {
    const attachment = await prisma.attachment.create({
      data: {
        messageId: null,
        uploadedById: trigger.conversation.userId,
        generatedForMessageId: triggerMessageId,
        filename: generatedFilename(request.filename, ext),
        storagePath,
        mimeType,
        size: buffer.length,
      },
    });
    return { ok: true, file: { id: attachment.id, filename: attachment.filename, mimeType: attachment.mimeType, size: attachment.size } };
  } catch (err) {
    await deleteUploadedFile(storagePath);
    throw err;
  }
}

/** Puts the turn's generated files under its reply. A turn that wrote no reply links nothing. */
export async function linkGeneratedFiles(triggerMessageId: string, assistantMessageId: string | null): Promise<GeneratedFileSummary[]> {
  if (!assistantMessageId) return [];
  await prisma.attachment.updateMany({
    where: { generatedForMessageId: triggerMessageId, messageId: null },
    data: { messageId: assistantMessageId },
  });
  return prisma.attachment.findMany({
    where: { generatedForMessageId: triggerMessageId, messageId: assistantMessageId },
    select: summary,
    orderBy: { createdAt: 'asc' },
  });
}

/** Before a retry re-runs the turn: drop what the failed attempt built, so the reply doesn't get duplicates. */
export async function discardUnlinkedGeneratedFiles(triggerMessageId: string): Promise<void> {
  const files = await prisma.attachment.findMany({
    where: { generatedForMessageId: triggerMessageId, messageId: null },
    select: { id: true, storagePath: true },
  });
  if (files.length === 0) return;
  await Promise.all(files.map((f) => deleteUploadedFile(f.storagePath)));
  await prisma.attachment.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
}

/**
 * End of a turn: put its files under the reply and tell the live client, so the
 * chips show without a reload. A failure here is reported, never thrown — the
 * answer itself is already saved and must still finish.
 */
export async function attachGeneratedFilesToReply(sink: SseSink, triggerMessageId: string, assistantMessageId: string | null): Promise<void> {
  try {
    const files = await linkGeneratedFiles(triggerMessageId, assistantMessageId);
    if (files.length > 0) sink.send(JSON.stringify({ type: 'files', messageId: assistantMessageId, files }));
  } catch (err) {
    Sentry.captureException(err, { extra: { triggerMessageId, assistantMessageId } });
  }
}
