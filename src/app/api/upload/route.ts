import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { validateMagicBytes, getExtensionFromMime, sanitizeFilename, saveUploadedFile } from '@/lib/upload';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > config.maxFileSize) {
    return NextResponse.json({ error: 'File too large. Maximum size is 10MB.' }, { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const conversationId = formData.get('conversationId') as string | null;

  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length > config.maxFileSize) {
    return NextResponse.json({ error: 'File too large. Maximum size is 10MB.' }, { status: 413 });
  }

  const detectedMime = validateMagicBytes(buffer);
  if (!detectedMime || !config.allowedMimeTypes.includes(detectedMime)) {
    return NextResponse.json(
      { error: 'Invalid file type. Allowed: JPEG, PNG, GIF, WebP.' },
      { status: 400 }
    );
  }

  const ext = getExtensionFromMime(detectedMime)!;
  const dirKey = conversationId || 'temp';
  const { storagePath, id: fileId } = await saveUploadedFile(buffer, dirKey, ext);

  const attachment = await prisma.attachment.create({
    data: {
      id: fileId,
      filename: sanitizeFilename(file.name),
      storagePath,
      mimeType: detectedMime,
      size: buffer.length,
    },
  });

  return NextResponse.json({
    id: attachment.id,
    filename: attachment.filename,
    url: `/api/upload/${attachment.id}`,
  });
}
