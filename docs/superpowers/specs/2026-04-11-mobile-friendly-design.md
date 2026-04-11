# Mobile-Friendly UI Design

**Date:** 2026-04-11
**Branch:** `feature/mobile-friendly` (off `feature/ui-polish`)

## Problem

The chat UI uses a fixed 256px sidebar and has zero responsive breakpoints. On screens below ~1024px the sidebar consumes 25%+ of the viewport, and on phones it's unusable.

## Breakpoint

- **`lg` (1024px)** is the cutoff.
- Below `lg`: mobile layout (sidebar hidden, hamburger menu).
- At `lg` and above: current desktop layout unchanged.

## Sidebar — Hamburger Overlay

### Mobile (below `lg`)
- Sidebar is hidden by default.
- A hamburger button (three-line icon) appears in the top-left corner of the chat area.
- Tapping the hamburger slides the sidebar in from the left as an overlay (`fixed inset-0 z-50`).
- A semi-transparent backdrop (`bg-black/50`) covers the rest of the screen.
- The sidebar closes when the user:
  - Taps the backdrop
  - Selects a conversation
  - Taps a close/X button inside the sidebar

### Desktop (`lg` and above)
- No changes. Sidebar remains a static `w-64` flex child.

### State Management
- `sidebarOpen` boolean state lives in `ChatPage.tsx`.
- `setSidebarOpen` is passed to `ChatSidebar` and used by the hamburger button.
- On conversation select, `ChatSidebar` calls `setSidebarOpen(false)`.

## Chat Area Adjustments

### ChatInput (`ChatInput.tsx`)
- Reduce horizontal padding on small screens: `px-2 lg:px-4`.
- Textarea remains full-width.
- Send button: ensure 44px minimum tap target.

### ChatMessages (`ChatMessages.tsx`)
- Reduce container padding: `px-2 lg:px-4`.
- Empty-state suggestion buttons: allow wrapping, reduce padding.

### MessageBubble (`MessageBubble.tsx`)
- Increase max-width on mobile so bubbles use more horizontal space: `max-w-[90%] lg:max-w-[75%]` (or similar).

### ChatPage Toolbar (flag/copy buttons)
- Ensure buttons don't overflow on narrow screens.
- Use `gap-1` on small screens, `gap-2` on `lg`.

## Touch Targets
- All interactive elements (buttons, nav links, conversation items) must be at least 44px tall/wide on mobile.
- Conversation list items in sidebar: add `min-h-[44px]` if not already met.

## Out of Scope
- Dashboard, settings, admin, login pages — no changes.
- No swipe gestures.
- No bottom navigation.
- No changes to the knowledge graph page.

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/ChatPage.tsx` | Add `sidebarOpen` state, hamburger button, pass props to sidebar |
| `src/components/ChatSidebar.tsx` | Overlay mode below `lg`, backdrop, close on select, close button |
| `src/components/ChatInput.tsx` | Responsive padding, tap-target sizing |
| `src/components/ChatMessages.tsx` | Responsive padding for message container |
| `src/components/MessageBubble.tsx` | Responsive max-width for bubbles |

## Testing

- Verify sidebar toggles correctly at various widths using browser devtools.
- Verify conversation selection closes sidebar on mobile.
- Verify backdrop click closes sidebar.
- Verify no layout shifts or overflow at 375px, 768px, 1024px, 1440px widths.
- Verify desktop layout is completely unchanged at `lg`+.
- Run `npm run build` to verify no type/build errors.
