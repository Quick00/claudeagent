# Featurebase Feedback Widget Design

## Overview

Add a Featurebase feedback widget to the Claude Agent app so all authenticated users can submit feature requests and bug reports directly from the sidebar. The widget uses Featurebase's JavaScript SDK, loaded the Next.js way via `next/script`, and pre-fills the user's name and email from their NextAuth session.

## Goals

- Let all authenticated users (regular and admin) submit feature requests and bug reports
- Integrate cleanly with the existing sidebar navigation
- Identify users automatically via their session data
- Follow Next.js conventions for third-party script loading

## Architecture

### New Component: `FeedbackWidget.tsx`

A `"use client"` component in `src/components/` that:

1. Uses `next/script` to load the Featurebase SDK from `https://do.featurebase.app/js/sdk.js` with `strategy="afterInteractive"`
2. Calls `useSession()` to get the current user's name and email
3. On script load, calls `Featurebase('initialize_feedback_widget', { organization, email, name, placement: 'manual' })` — manual placement suppresses the default floating button
4. Renders a sidebar-styled button labeled "Feedback" that calls `Featurebase('manually_open_feedback_widget')` on click

### Sidebar Integration

- `FeedbackWidget` is rendered inside `ChatSidebar.tsx` at the bottom of the nav, above any logout/settings links
- Styled consistently with existing sidebar nav items (same Tailwind classes, hover/active states)
- Includes a megaphone or message-bubble SVG icon

### Environment Configuration

- `NEXT_PUBLIC_FEATUREBASE_ORG` — the Featurebase organization slug, added to `.env.example`

## Data Flow

1. `useSession()` provides `session.user.name` and `session.user.email`
2. These are passed to the Featurebase `initialize_feedback_widget` call on SDK load
3. No server-side work needed — Featurebase handles all feedback storage
4. No local database changes or new Prisma models required

## Widget Lifecycle

1. SDK script loads once via `next/script` with `strategy="afterInteractive"`
2. Widget initializes after script loads (via `onLoad` callback)
3. User clicks "Feedback" in sidebar -> calls `Featurebase('manually_open_feedback_widget')`
4. Featurebase popup opens as an overlay — user submits and closes
5. No local state management needed

## Graceful Handling

- If session is not loaded yet, the widget initializes without user data (Featurebase still works, just won't pre-fill)
- If the SDK fails to load, the sidebar button still renders but clicking it is a silent no-op

## UI

- No new pages or routes
- Widget opens as a Featurebase popup overlay on top of the current page
- Sidebar button matches existing nav item styling

## Testing

- Unit test for `FeedbackWidget`: verify it renders, calls `Featurebase` on script load with correct params
- Mock `useSession` to test user identification pass-through
- Mock `next/script` to verify SDK URL and strategy

## Files Changed

- `src/components/FeedbackWidget.tsx` — new client component
- `src/components/ChatSidebar.tsx` — add FeedbackWidget to sidebar nav
- `.env.example` — add `NEXT_PUBLIC_FEATUREBASE_ORG`
