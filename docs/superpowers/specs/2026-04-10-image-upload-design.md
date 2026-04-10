# Image Upload Support

**Date:** 2026-04-10
**Status:** Approved

## Overview

Add image upload support to the chat interface, allowing users to attach up to 3 images (JPEG, PNG, GIF, WebP) per message. Images are saved to a Docker-mounted volume and referenced in the Claude CLI stdin so Claude Code reads them with its native Read tool.

## Approach

**File path in stdin message.** Upload images to server, save to mounted volume, append file paths to the text message sent to Claude's stdin. Claude Code's Read tool natively reads images — no CLI flag changes needed.

## Storage

- Images saved to `UPLOAD_PATH` (default: `./uploads` for dev, `/uploads` for Docker)
- Directory structure: `/{conversationId}/{uuid}.{ext}`
- Docker volume mount: `./uploads:/uploads` in docker-compose.yml
- `uploads/` added to `.gitignore` and `.dockerignore`
- Files deleted when conversation is deleted (cascade)

## Database Changes

New `Attachment` model:

```prisma
model Attachment {
  id          String   @id @default(uuid())
  messageId   String?
  filename    String   // original filename for display
  storagePath String   // path on disk
  mimeType    String   // e.g. "image/png"
  size        Int      // bytes
  createdAt   DateTime @default(now())
  message     Message?  @relation(fields: [messageId], references: [id], onDelete: Cascade)
}
```

`Message` model gets `attachments Attachment[]` relation.

## API Routes

### `POST /api/upload`

- Accepts `multipart/form-data` with `file` field and optional `conversationId`
- Validates auth, file type (magic bytes), file size (max 10MB)
- Saves file as `{uuid}.{ext}` under the conversation directory
- Creates an `Attachment` record with `messageId` as null initially
- Returns `{ id, filename, url }`

Note: Attachments are created without a `messageId` on upload. The chat API links them to the user message after creating it. This means the `messageId` field on `Attachment` must be nullable.

### `GET /api/upload/[id]`

- Serves the image file from disk
- Auth-gated: only conversation owner or admin can access

## Chat Flow

### Frontend (`ChatInput.tsx`)

- Paperclip/image button next to textarea
- Hidden `<input type="file" accept="image/*" multiple>` (max 3)
- Selected images shown as removable thumbnails below textarea
- On send: upload each image to `POST /api/upload`, collect IDs, send `{ conversationId, message, attachmentIds }` to chat API

### Chat API (`/api/chat/route.ts`)

- Accept `attachmentIds` in request body
- Link attachments to the created user message
- Append to stdin message:

```
---
The user attached N image(s). Read each one with the Read tool before responding:
- /uploads/conv-id/uuid.png (original-name.png, 245KB)
```

### Message Display (`MessageBubble.tsx`)

- User messages: render attached images as inline thumbnails (max-height ~200px)
- Click to open full size in new tab
- Thumbnails loaded from `GET /api/upload/[id]`

### Conversation Loading (`/api/conversations/[id]`)

- Include attachments in message response for thumbnail rendering on reload

## Validation & Security

### Upload Validation (server-side)

- **Magic byte check:** Verify file header matches claimed type
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47`
  - GIF: `47 49 46 38`
  - WebP: `52 49 46 46...57 45 42 50`
- **File size:** Reject > 10MB (check Content-Length early, verify actual size)
- **Max per message:** 3 images, enforced client-side and server-side
- **Filename sanitization:** UUID for storage, original name in DB only

### Access Control

- Upload route: authenticated users only
- Serving route: conversation owner or admin only
- No direct UUID guessing grants access

### Docker

- Volume mount in docker-compose.yml: `./uploads:/uploads`
- `UPLOAD_PATH` env var in `.env.example`
- Non-root container user has write access to mount

## Constraints

- Formats: JPEG, PNG, GIF, WebP only (what Claude can read)
- Max file size: 10MB per image
- Max images per message: 3

## No Changes To

- Session manager (stdin/stdout flow unchanged)
- MCP config (no new tools)
- Prisma adapter setup
