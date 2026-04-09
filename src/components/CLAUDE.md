# src/components/

All components are React client components (`'use client'`).

## Chat System Components

- `ChatPage.tsx` — Main chat container. Manages conversation state, SSE streaming, message accumulation. Entry point for `/` and `/conversation/[id]`.
- `ChatSidebar.tsx` — Left sidebar with conversation list, navigation links, user profile. Refreshes via `refreshTrigger` prop.
- `ChatMessages.tsx` — Renders message list, streaming content, thinking indicators, tool status, and empty-state suggestions.
- `ChatInput.tsx` — Auto-resizing textarea. Enter to send, Shift+Enter for newline.
- `MessageBubble.tsx` — Single message bubble. User = right-aligned blue, Assistant = left-aligned gray with markdown rendering.

## Patterns

- State lives in `ChatPage` and is passed down as props.
- SSE events from `/api/chat` are parsed in `ChatPage.handleSend()`. Event types: `conversation_created`, `text`, `tool_use`, `done`, `error`.
- Session/auth via `useSession()` from `next-auth/react`.
- Sidebar navigation shows admin links conditionally based on `session.user.role === 'admin'`.
