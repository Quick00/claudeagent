import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import { uploadTypeForMime } from '@/lib/upload-types';

/**
 * Filenames come from users and, for generated files, from the model: the quoted
 * form keeps printable ASCII minus quotes and backslashes, and `filename*`
 * carries the real name percent-encoded (RFC 6266), so nothing can break the header.
 */
function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  const { id } = await params;

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      message: {
        include: {
          conversation: { select: { userId: true } },
        },
      },
    },
  });

  if (!attachment) {
    return new Response('Not found', { status: 404 });
  }

  // Access check: admin, the conversation's owner once the upload is in a message, and
  // its uploader before that (a feedback screenshot is never in a message).
  const owner = attachment.message?.conversation.userId ?? attachment.uploadedById;
  if (user.role !== 'admin' && owner !== user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const fileBuffer = await readFile(attachment.storagePath);
    // Images and PDFs open in the browser; everything else downloads. Text is served as
    // plain text and nosniff is always set, so an uploaded .xml or .md can never run as a page.
    const kind = uploadTypeForMime(attachment.mimeType)?.kind;
    const inline = kind === 'image' || kind === 'pdf';
    return new Response(fileBuffer, {
      headers: {
        'Content-Type': kind === 'text' ? 'text/plain; charset=utf-8' : attachment.mimeType,
        'Content-Length': String(attachment.size),
        'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', attachment.filename),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return new Response('File not found', { status: 404 });
  }
}
