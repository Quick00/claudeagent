import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';
import { uploadTypeForMime } from '@/lib/upload-types';

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

  // Access check: conversation owner or admin
  if (attachment.message?.conversation) {
    const isOwner = attachment.message.conversation.userId === user.id;
    const isAdmin = user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return new Response('Forbidden', { status: 403 });
    }
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
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${attachment.filename}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return new Response('File not found', { status: 404 });
  }
}
