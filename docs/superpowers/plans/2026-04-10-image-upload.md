# Image Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to attach up to 3 images (JPEG/PNG/GIF/WebP) per chat message, stored on a Docker-mounted volume, with Claude Code reading them via its native Read tool.

**Architecture:** Images uploaded via a new `/api/upload` route, saved to a mounted volume at `UPLOAD_PATH`. Attachments tracked in a new `Attachment` model linked to messages. The chat API appends file paths to the stdin message so Claude reads them. Frontend shows inline thumbnails in message bubbles.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Tailwind CSS 4, Jest 30

**Spec:** `docs/superpowers/specs/2026-04-10-image-upload-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `prisma/schema.prisma` | Add `Attachment` model, update `Message` |
| Modify | `src/lib/config.ts` | Add `uploadPath` and upload constants |
| Create | `src/lib/upload.ts` | Validation (magic bytes, size, mime) and file save/delete helpers |
| Create | `src/app/api/upload/route.ts` | `POST /api/upload` — receive and store images |
| Create | `src/app/api/upload/[id]/route.ts` | `GET /api/upload/:id` — serve images (auth-gated) |
| Modify | `src/app/api/chat/route.ts` | Accept `attachmentIds`, link to message, append paths to stdin |
| Modify | `src/app/api/conversations/[id]/route.ts` | Include attachments in message response; delete files on conversation delete |
| Modify | `src/components/ChatInput.tsx` | File picker button, image previews, upload-then-send flow |
| Modify | `src/components/MessageBubble.tsx` | Render inline image thumbnails for user messages |
| Modify | `src/components/ChatPage.tsx` | Pass `attachments` through to message components |
| Modify | `src/components/ChatMessages.tsx` | Pass `attachments` to `MessageBubble` |
| Modify | `docker-compose.yml` | Add uploads volume mount |
| Modify | `docker-entrypoint.sh` | Ensure uploads dir ownership |
| Modify | `.env.example` | Add `UPLOAD_PATH` |
| Modify | `.gitignore` | Add `uploads/` |
| Create | `src/__tests__/upload.test.ts` | Tests for validation and file helpers |

---

## Task 1: Database — Add Attachment model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add Attachment model and update Message**

Add to `prisma/schema.prisma` — after the `Message` model, add:

```prisma
model Attachment {
  id          String   @id @default(uuid())
  messageId   String?
  filename    String
  storagePath String
  mimeType    String
  size        Int
  createdAt   DateTime @default(now())
  message     Message? @relation(fields: [messageId], references: [id], onDelete: Cascade)
}
```

Add the relation to the existing `Message` model — add this line inside the `Message` model block:

```prisma
  attachments    Attachment[]
```

- [ ] **Step 2: Generate Prisma client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" success message

- [ ] **Step 3: Create migration**

Run: `npx prisma migrate dev --name add-attachment-model`
Expected: Migration created and applied successfully

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add Attachment model to schema"
```

---

## Task 2: Config — Add upload constants

**Files:**
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Add upload config**

In `src/lib/config.ts`, add these fields to the `config` object (before `systemPrompt`):

```typescript
uploadPath: process.env.UPLOAD_PATH || './uploads',
maxFileSize: 10 * 1024 * 1024, // 10MB
maxFilesPerMessage: 3,
allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as readonly string[],
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/config.ts
git commit -m "feat: add upload config constants"
```

---

## Task 3: Upload utility — Validation and file helpers

**Files:**
- Create: `src/lib/upload.ts`
- Create: `src/__tests__/upload.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/upload.test.ts`:

```typescript
import { validateMagicBytes, getExtensionFromMime, sanitizeFilename } from '@/lib/upload';

describe('upload validation', () => {
  describe('validateMagicBytes', () => {
    it('accepts valid JPEG', () => {
      const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x00]);
      expect(validateMagicBytes(buf)).toBe('image/jpeg');
    });

    it('accepts valid PNG', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
      expect(validateMagicBytes(buf)).toBe('image/png');
    });

    it('accepts valid GIF', () => {
      const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(validateMagicBytes(buf)).toBe('image/gif');
    });

    it('accepts valid WebP', () => {
      // RIFF....WEBP
      const buf = Buffer.alloc(12);
      buf.write('RIFF', 0);
      buf.writeUInt32LE(100, 4);
      buf.write('WEBP', 8);
      expect(validateMagicBytes(buf)).toBe('image/webp');
    });

    it('rejects unknown format', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      expect(validateMagicBytes(buf)).toBeNull();
    });

    it('rejects empty buffer', () => {
      const buf = Buffer.alloc(0);
      expect(validateMagicBytes(buf)).toBeNull();
    });
  });

  describe('getExtensionFromMime', () => {
    it('returns jpg for image/jpeg', () => {
      expect(getExtensionFromMime('image/jpeg')).toBe('jpg');
    });

    it('returns png for image/png', () => {
      expect(getExtensionFromMime('image/png')).toBe('png');
    });

    it('returns gif for image/gif', () => {
      expect(getExtensionFromMime('image/gif')).toBe('gif');
    });

    it('returns webp for image/webp', () => {
      expect(getExtensionFromMime('image/webp')).toBe('webp');
    });

    it('returns null for unsupported mime', () => {
      expect(getExtensionFromMime('application/pdf')).toBeNull();
    });
  });

  describe('sanitizeFilename', () => {
    it('keeps simple filenames', () => {
      expect(sanitizeFilename('photo.png')).toBe('photo.png');
    });

    it('strips directory traversal', () => {
      expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
    });

    it('replaces special characters', () => {
      expect(sanitizeFilename('my file (1).png')).toBe('my_file__1_.png');
    });

    it('truncates long names', () => {
      const long = 'a'.repeat(300) + '.png';
      expect(sanitizeFilename(long).length).toBeLessThanOrEqual(255);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/upload.test.ts --verbose`
Expected: FAIL — "Cannot find module '@/lib/upload'"

- [ ] **Step 3: Implement upload utility**

Create `src/lib/upload.ts`:

```typescript
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
  // Strip path components
  const basename = name.split('/').pop()!.split('\\').pop()!;
  // Replace anything not alphanumeric, dot, hyphen, underscore
  const cleaned = basename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  // Truncate to 255 chars
  return cleaned.slice(0, 255);
}

export async function saveUploadedFile(
  buffer: Buffer,
  conversationId: string,
  ext: string
): Promise<{ storagePath: string; id: string }> {
  const id = randomUUID();
  const dir = path.join(config.uploadPath, conversationId);
  await mkdir(dir, { recursive: true });
  const filename = `${id}.${ext}`;
  const storagePath = path.join(dir, filename);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/upload.test.ts --verbose`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload.ts src/__tests__/upload.test.ts
git commit -m "feat: add upload validation and file helpers"
```

---

## Task 4: Upload API — POST /api/upload

**Files:**
- Create: `src/app/api/upload/route.ts`

- [ ] **Step 1: Create the upload route**

Create `src/app/api/upload/route.ts`:

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`
Expected: No type errors (or only pre-existing ones)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/upload/route.ts
git commit -m "feat: add POST /api/upload route"
```

---

## Task 5: Serve API — GET /api/upload/[id]

**Files:**
- Create: `src/app/api/upload/[id]/route.ts`

- [ ] **Step 1: Create the serve route**

Create `src/app/api/upload/[id]/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readFile } from 'fs/promises';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return new Response('Not found', { status: 404 });
  }

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
    return new Response(fileBuffer, {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': String(attachment.size),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch {
    return new Response('File not found', { status: 404 });
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`
Expected: No type errors (or only pre-existing ones)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/upload/\[id\]/route.ts
git commit -m "feat: add GET /api/upload/[id] serve route"
```

---

## Task 6: Chat API — Accept attachments and append to stdin

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: Update request body parsing**

In `src/app/api/chat/route.ts`, change the body destructuring (around line 45-49) from:

```typescript
  const body = await request.json();
  const { conversationId, message } = body as {
    conversationId: string | null;
    message: string;
  };
```

to:

```typescript
  const body = await request.json();
  const { conversationId, message, attachmentIds } = body as {
    conversationId: string | null;
    message: string;
    attachmentIds?: string[];
  };
```

- [ ] **Step 2: Add attachment linking and stdin message building**

After the user message is created in the DB (after the `await prisma.message.create(...)` call around line 73-79), add this block:

```typescript
  // Link attachments to the user message and build image references for CLI
  let cliMessage = message;
  if (attachmentIds && attachmentIds.length > 0) {
    const attachments = await prisma.attachment.findMany({
      where: { id: { in: attachmentIds.slice(0, config.maxFilesPerMessage) } },
    });

    if (attachments.length > 0) {
      // Link attachments to the message
      await prisma.attachment.updateMany({
        where: { id: { in: attachments.map((a) => a.id) } },
        data: { messageId: userMessage.id },
      });

      // Append image paths to the message for Claude CLI
      const imageLines = attachments.map((a) => {
        const sizeKB = (a.size / 1024).toFixed(1);
        return `- ${a.storagePath} (${a.filename}, ${sizeKB}KB)`;
      });
      cliMessage += `\n\n---\nThe user attached ${attachments.length} image(s). Read each one with the Read tool before responding:\n${imageLines.join('\n')}`;
    }
  }
```

Also update the `prisma.message.create` call to capture the result — change:

```typescript
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });
```

to:

```typescript
  const userMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
    },
  });
```

- [ ] **Step 3: Use cliMessage instead of message for CLI stdin**

In the same file, find both places where `message` is passed to `sessionManager`:

1. Around line 333-334 (initial spawn):
```typescript
      const procOrPromise = conversation.claudeSessionId
        ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, message, userClaudeToken, userId)
        : sessionManager.startSession(requestId, message, systemPrompt, userClaudeToken, userId);
```

Change `message` to `cliMessage` in both calls:
```typescript
      const procOrPromise = conversation.claudeSessionId
        ? sessionManager.resumeSession(requestId, conversation.claudeSessionId, cliMessage, userClaudeToken, userId)
        : sessionManager.startSession(requestId, cliMessage, systemPrompt, userClaudeToken, userId);
```

2. Around line 252-254 (retry spawn):
```typescript
                  const retryProcOrPromise = conversation.claudeSessionId
                    ? sessionManager.resumeSession(retryRequestId, conversation.claudeSessionId, message, userClaudeToken, userId)
                    : sessionManager.startSession(retryRequestId, message, systemPrompt, userClaudeToken, userId);
```

Change `message` to `cliMessage`:
```typescript
                  const retryProcOrPromise = conversation.claudeSessionId
                    ? sessionManager.resumeSession(retryRequestId, conversation.claudeSessionId, cliMessage, userClaudeToken, userId)
                    : sessionManager.startSession(retryRequestId, cliMessage, systemPrompt, userClaudeToken, userId);
```

- [ ] **Step 4: Import config**

Add `config` to the imports at the top if not already present:

```typescript
import { config } from '@/lib/config';
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit --pretty`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: accept attachmentIds in chat API, append image paths to CLI stdin"
```

---

## Task 7: Conversation API — Include attachments and clean up files on delete

**Files:**
- Modify: `src/app/api/conversations/[id]/route.ts`

- [ ] **Step 1: Include attachments in GET response**

In `src/app/api/conversations/[id]/route.ts`, update the `include` in the `findFirst` query (around line 28). Change:

```typescript
      messages: {
        orderBy: { createdAt: 'asc' },
      },
```

to:

```typescript
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          attachments: {
            select: { id: true, filename: true, mimeType: true, size: true },
          },
        },
      },
```

- [ ] **Step 2: Delete uploaded files on conversation delete**

In the same file, in the `DELETE` handler, add file cleanup before the `prisma.conversation.delete` call. Add these imports at the top:

```typescript
import { deleteUploadedFile } from '@/lib/upload';
```

Then before the `await prisma.conversation.delete(...)` call, add:

```typescript
  // Delete uploaded files for this conversation
  const messages = await prisma.message.findMany({
    where: { conversationId: id },
    include: { attachments: true },
  });
  for (const msg of messages) {
    for (const attachment of msg.attachments) {
      await deleteUploadedFile(attachment.storagePath);
    }
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/app/api/conversations/\[id\]/route.ts
git commit -m "feat: include attachments in conversation response, clean up files on delete"
```

---

## Task 8: Frontend — ChatInput with file picker

**Files:**
- Modify: `src/components/ChatInput.tsx`

- [ ] **Step 1: Update the ChatInput component**

Replace the entire contents of `src/components/ChatInput.tsx`:

```tsx
'use client';

import { useState, useRef, useCallback } from 'react';

interface PendingImage {
  file: File;
  preview: string;
}

interface ChatInputProps {
  onSend: (message: string, attachmentIds: string[]) => void;
  disabled: boolean;
}

const MAX_FILES = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const valid: PendingImage[] = [];

    for (const file of fileArray) {
      if (images.length + valid.length >= MAX_FILES) break;
      if (!ACCEPTED_TYPES.includes(file.type)) continue;
      if (file.size > MAX_FILE_SIZE) continue;
      valid.push({ file, preview: URL.createObjectURL(file) });
    }

    if (valid.length > 0) {
      setImages((prev) => [...prev, ...valid].slice(0, MAX_FILES));
    }
  }, [images.length]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if ((!trimmed && images.length === 0) || disabled || uploading) return;

    let attachmentIds: string[] = [];

    if (images.length > 0) {
      setUploading(true);
      try {
        const uploadPromises = images.map(async (img) => {
          const formData = new FormData();
          formData.append('file', img.file);
          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          if (!res.ok) throw new Error('Upload failed');
          const data = await res.json();
          return data.id as string;
        });
        attachmentIds = await Promise.all(uploadPromises);
      } catch {
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    // Clean up preview URLs
    for (const img of images) {
      URL.revokeObjectURL(img.preview);
    }

    onSend(trimmed || 'Please look at the attached image(s).', attachmentIds);
    setInput('');
    setImages([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, images, disabled, uploading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="mx-auto max-w-3xl">
        {images.length > 0 && (
          <div className="mb-3 flex gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative">
                <img
                  src={img.preview}
                  alt={img.file.name}
                  className="h-16 w-16 rounded-lg border border-gray-200 object-cover"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-700 text-xs text-white hover:bg-gray-900"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className="flex items-end gap-3"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading || images.length >= MAX_FILES}
            className="mb-1 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            title="Attach image"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about the platform..."
            disabled={disabled || uploading}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={handleSubmit}
            disabled={disabled || uploading || (!input.trim() && images.length === 0)}
            className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {uploading ? 'Uploading...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty`
Expected: Type error on `ChatPage.tsx` because `onSend` signature changed — that's expected and fixed in Task 10.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatInput.tsx
git commit -m "feat: add image picker, previews, and drag-drop to ChatInput"
```

---

## Task 9: Frontend — MessageBubble with inline thumbnails

**Files:**
- Modify: `src/components/MessageBubble.tsx`

- [ ] **Step 1: Update MessageBubble to render image attachments**

Replace the entire contents of `src/components/MessageBubble.tsx`:

```tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'admin';
  content: string;
  adminName?: string;
  timestamp?: string;
  attachments?: Attachment[];
}

export default function MessageBubble({ role, content, adminName, timestamp, attachments }: MessageBubbleProps) {
  const imageAttachments = attachments?.filter((a) => a.mimeType.startsWith('image/')) ?? [];

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%]">
          {imageAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {imageAttachments.map((att) => (
                <a
                  key={att.id}
                  href={`/api/upload/${att.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={`/api/upload/${att.id}`}
                    alt={att.filename}
                    className="max-h-[200px] max-w-[300px] rounded-xl border border-blue-400 object-contain"
                  />
                </a>
              ))}
            </div>
          )}
          <div className="rounded-2xl bg-blue-600 px-4 py-3 text-white">
            <p className="whitespace-pre-wrap">{content}</p>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'admin') {
    return (
      <div className="flex justify-start">
        <div className="w-full overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-gray-900">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-amber-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Admin{adminName ? ` — ${adminName}` : ''}</span>
            {timestamp && (
              <span className="text-amber-500">{new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="w-full overflow-hidden rounded-2xl bg-gray-100 px-4 py-3 text-gray-900">
        <div className="prose prose-sm max-w-none overflow-x-auto prose-table:text-sm prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MessageBubble.tsx
git commit -m "feat: render inline image thumbnails in MessageBubble"
```

---

## Task 10: Frontend — Wire up ChatPage and ChatMessages

**Files:**
- Modify: `src/components/ChatPage.tsx`
- Modify: `src/components/ChatMessages.tsx`

- [ ] **Step 1: Update the Message interface in ChatPage.tsx**

In `src/components/ChatPage.tsx`, update the `Message` interface (around line 11-15) from:

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}
```

to:

```typescript
interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}
```

- [ ] **Step 2: Update handleSend signature**

In the same file, change the `handleSend` function signature (around line 164) from:

```typescript
  const handleSend = async (message: string) => {
```

to:

```typescript
  const handleSend = async (message: string, attachmentIds: string[] = []) => {
```

- [ ] **Step 3: Include attachmentIds in the fetch body**

In `handleSend`, update the fetch call body (around line 178) from:

```typescript
        body: JSON.stringify({ conversationId, message }),
```

to:

```typescript
        body: JSON.stringify({ conversationId, message, attachmentIds }),
```

- [ ] **Step 4: Include attachments when adding user message optimistically**

Update the optimistic user message (around line 166-169). Change:

```typescript
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: 'user', content: message },
    ]);
```

to:

```typescript
    const tempId = `temp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: 'user', content: message, attachments: [] },
    ]);
```

Note: The optimistic message won't show image thumbnails (attachments are empty), but they'll appear on reload from the DB. This is acceptable since the user just saw the preview in the input area.

- [ ] **Step 5: Preserve attachments when loading messages from API**

In `loadConversation` (around line 77) and the visibility polling (around line 107), update the message mapping to include attachments. Both map calls look like:

```typescript
    setMessages(
      data.messages.map((m: { id: string; role: string; content: string }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      }))
    );
```

Change both to:

```typescript
    setMessages(
      data.messages.map((m: { id: string; role: string; content: string; attachments?: Attachment[] }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      }))
    );
```

- [ ] **Step 6: Update ChatMessages interface and pass attachments through**

In `src/components/ChatMessages.tsx`, add the `Attachment` interface and update `Message`:

```typescript
interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}
```

Then update the `MessageBubble` render in the messages map (around line 104) from:

```tsx
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
```

to:

```tsx
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} attachments={msg.attachments} />
```

- [ ] **Step 7: Verify it compiles**

Run: `npx tsc --noEmit --pretty`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add src/components/ChatPage.tsx src/components/ChatMessages.tsx
git commit -m "feat: wire up attachments through ChatPage and ChatMessages"
```

---

## Task 11: Docker and config — Volume mount, env, gitignore

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-entrypoint.sh`
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Add uploads volume to docker-compose.yml**

In `docker-compose.yml`, add the uploads volume to the `app` service `volumes` list:

```yaml
      - ./uploads:/app/uploads
```

And add the env var to the `environment` list:

```yaml
      - UPLOAD_PATH=/app/uploads
```

- [ ] **Step 2: Add uploads dir ownership to docker-entrypoint.sh**

In `docker-entrypoint.sh`, after the `chown -R nextjs:nodejs /app/repo` line, add:

```bash
# Ensure uploads directory exists and is writable
mkdir -p /app/uploads
chown -R nextjs:nodejs /app/uploads
```

- [ ] **Step 3: Add UPLOAD_PATH to .env.example**

In `.env.example`, add under the `# Optional` section:

```
UPLOAD_PATH=./uploads
```

- [ ] **Step 4: Add uploads/ to .gitignore**

In `.gitignore`, add at the end:

```
# uploaded images
/uploads
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml docker-entrypoint.sh .env.example .gitignore
git commit -m "feat: add uploads volume mount and config"
```

---

## Task 12: Run full test suite and build

- [ ] **Step 1: Run tests**

Run: `npx jest --verbose`
Expected: All tests pass (existing crypto tests + new upload tests)

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No new lint errors

- [ ] **Step 4: Fix any issues found, commit if needed**

If any step fails, fix the issue and commit the fix.
