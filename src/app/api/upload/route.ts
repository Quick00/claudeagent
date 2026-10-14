import { requireApprovedUser } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { detectUploadType, extractText, sanitizeFilename, saveUploadedFile, deleteUploadedFile, UploadRefused } from '@/lib/upload';
import { UPLOAD_TYPES_LABEL } from '@/lib/upload-types';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;

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

  const type = detectUploadType(buffer, file.name);
  if (!type) {
    return NextResponse.json(
      { error: `Invalid file type. Allowed: ${UPLOAD_TYPES_LABEL}.` },
      { status: 400 }
    );
  }

  let extracted: string | null;
  try {
    extracted = await extractText(buffer, type);
  } catch (err) {
    const name = sanitizeFilename(file.name);
    const reason = err instanceof UploadRefused
      ? `${name} ${err.message}`
      : `Could not read ${name}. It may be damaged or password-protected.`;
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  const dirKey = conversationId || 'temp';
  const { storagePath, id: fileId } = await saveUploadedFile(buffer, dirKey, type.ext, extracted);

  let attachment;
  try {
    attachment = await prisma.attachment.create({
      data: {
        id: fileId,
        uploadedById: auth.user.id,
        filename: sanitizeFilename(file.name),
        storagePath,
        mimeType: type.mime,
        size: buffer.length,
      },
    });
  } catch (err) {
    await deleteUploadedFile(storagePath);
    throw err;
  }

  return NextResponse.json({
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: `/api/upload/${attachment.id}`,
  });
}
