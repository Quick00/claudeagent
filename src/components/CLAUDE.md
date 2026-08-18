# src/components/

All components are React client components (`'use client'`).

## Chat System Components

- `ChatPage.tsx` — Main chat container. Manages conversation state, SSE streaming, message accumulation. Entry point for `/` and `/conversation/[id]`.
- `ChatSidebar.tsx` — Left sidebar with conversation list, navigation links, user profile. Refreshes via `refreshTrigger` prop.
- `ChatMessages.tsx` — Renders message list, streaming content, thinking indicators, tool status, and empty-state suggestions.
- `ChatInput.tsx` — Auto-resizing textarea. Enter to send, Shift+Enter for newline.
- `MessageBubble.tsx` — Single message bubble. User = right-aligned blue, Assistant = left-aligned gray with markdown rendering.

## Other Components

- `KnowledgeGraph.tsx` — Force-directed graph visualization of knowledge entries using react-force-graph-2d.
- `FeedbackModal.tsx` — Multi-step feedback form (type → title → description → optional screenshot). Posts to `/api/feedback`.
- `LinkClaudeModal.tsx` — Step-by-step modal for linking a Claude account via setup token. OS-aware (macOS terminal flow vs Windows installer download).
- `SettingsPanel.tsx` — User settings panel (Claude account linking, appearance). Admins also get the "Require approval for new accounts" toggle, backed by `/api/admin/settings`.
- `AdminUsersPanel.tsx` — Admin panel for listing users, managing roles, and approving or rejecting accounts. Pending accounts sort first.
- `AdminFlagsPanel.tsx` — Admin panel for reviewing and responding to user flags.
- `AdminFeedbackPanel.tsx` — Admin panel for reviewing feedback posts and updating status (TODO → IN_PROGRESS → DONE).
- `AdminUserConversationsPanel.tsx` — Admin panel showing a user's conversations with ability to view and send messages.
- `DialogOverlay.tsx` — Reusable modal/dialog overlay wrapper.
- `ThemeProvider.tsx` — Dark/light mode provider.
- `Providers.tsx` — Context providers wrapper (SessionProvider from next-auth, ThemeProvider, ApprovalGate).
- `ApprovalGate.tsx` — Redirects signed-in-but-unapproved accounts to `/pending`. UI-level only; the API guards are what protect the data.

## Patterns

- State lives in `ChatPage` and is passed down as props.
- SSE events from `/api/chat` are parsed in `ChatPage.handleSend()`. Event types: `conversation_created`, `text`, `tool_use`, `done`, `error`.
- Session/auth via `useSession()` from `next-auth/react`.
- Sidebar navigation shows admin links conditionally based on `session.user.role === 'admin'`.
