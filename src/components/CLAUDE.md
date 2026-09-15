# src/components/

All components are React client components (`'use client'`).

## Chat System Components

- `ChatPage.tsx` — Main chat container. Manages conversation state, SSE streaming, message accumulation. Entry point for `/` and `/conversation/[id]`.
- `ChatSidebar.tsx` — Left sidebar with conversation list, navigation links, user profile. Refreshes via `refreshTrigger` prop.
- `ChatMessages.tsx` — Renders message list, streaming content, thinking indicators, tool status, and empty-state suggestions.
- `ChatInput.tsx` — Auto-resizing textarea. Enter to send, Shift+Enter for newline.
- `MessageBubble.tsx` — Single message bubble. User = right-aligned blue, Assistant = left-aligned gray with markdown rendering.

## Other Components

- `knowledge/KnowledgeGraph.tsx` — Force-directed knowledge map using react-force-graph-2d. Rendering rules live in `knowledge/graph-view.ts` (pure, unit-tested): single-use topics are folded away behind a toggle, labels appear by zoom level (top 40 topics zoomed out, 3+ pages at mid zoom, everything when zoomed in), pages draw as small dots, and selecting a node highlights its neighbourhood and fades the rest.
- `shared/MarkdownEditor.tsx` — The app's one rich-text field: TipTap + `tiptap-markdown`, so its `value`/`onChange` are plain markdown strings that round-trip through `MarkdownContent` unchanged. Pass `blocks` wherever the stored value is a real document (headings, code, quotes) rather than short free text, and `toolbarExtra` to append caller-specific controls. Used by `FeedbackModal` and the knowledge entry dialog.
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
- SSE events from `/api/chat` are parsed in `ChatPage.handleSend()`. Event types: `conversation_created`, `text`, `text_break`, `tool_use`, `done`, `error`.
- `text_break` closes the current assistant bubble and opens the next one. The server emits it before each `tool_use` that interrupts text, and persists the same split: an answer that ran a tool mid-way becomes **several** assistant `Message` rows, one per bubble, with `createdAt` a millisecond apart so the reload order is deterministic.
- Session/auth via `useSession()` from `next-auth/react`.
- Sidebar navigation shows admin links conditionally based on `session.user.role === 'admin'`.
