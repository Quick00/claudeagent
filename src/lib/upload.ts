import { mkdir, writeFile, unlink, access } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '@/lib/config';

const MAGIC_BYTES: { prefix: number[]; offset?: number; mime: string; extra?: { offset: number; bytes: number[]; } }[] = [
  { prefix: [0xFF, 0xD8, 0xFF], mime: 'image/jpeg' },
  { prefix: [0x89, 0x50, 0x4E, 0x47], mime: 'image/png' },
  { prefix: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  {
    prefix: [0x52, 0x49, 0x46, 0x46], // RIFF
    mime: 'image/webp',
    extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
  },
];

export function validateMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  for (const sig of MAGIC_BYTES) {
    const prefixMatch = sig.prefix.every((byte, i) => buffer[i] === byte);
    if (!prefixMatch) continue;

    if (sig.extra) {
      if (buffer.length < sig.extra.offset + sig.extra.bytes.length) continue;
      const extraMatch = sig.extra.bytes.every(
        (byte, i) => buffer[sig.extra!.offset + i] === byte
      );
      if (!extraMatch) continue;
    }

    return sig.mime;
  }

  return null;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function getExtensionFromMime(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

export function sanitizeFilename(name: string): string {
  const basename = name.split('/').pop()!.split('\\').pop()!;
  const cleaned = basename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  return cleaned.slice(0, 255);
}

export async function saveUploadedFile(
  buffer: Buffer,
  conversationId: string,
  ext: string
): Promise<{ storagePath: string; id: string }> {
  const id = randomUUID();
  const uploadRoot = path.resolve(config.uploadPath);
  const dir = path.resolve(path.join(uploadRoot, conversationId));
  if (dir !== uploadRoot && !dir.startsWith(uploadRoot + path.sep)) {
    throw new Error('Invalid upload path');
  }
  await mkdir(dir, { recursive: true });
  const filename = `${id}.${ext}`;
  const storagePath = path.resolve(path.join(dir, filename));
  await writeFile(storagePath, buffer);
  return { storagePath, id };
}

export async function deleteUploadedFile(storagePath: string): Promise<void> {
  try {
    await access(storagePath);
    await unlink(storagePath);
  } catch {
    // File already gone, ignore
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
