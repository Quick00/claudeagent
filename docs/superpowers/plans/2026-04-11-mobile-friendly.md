# Mobile-Friendly UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat UI responsive with a hamburger-menu sidebar that collapses below the `lg` (1024px) breakpoint.

**Architecture:** Add `sidebarOpen` state to ChatPage, pass it to ChatSidebar which renders as a fixed overlay below `lg` and a static sidebar at `lg`+. A hamburger button in ChatPage toggles the sidebar on mobile. Responsive Tailwind classes adjust padding and sizing across ChatInput, ChatMessages, and MessageBubble.

**Tech Stack:** Tailwind CSS 4 responsive prefixes (`lg:`), React state, no new dependencies.

---

### Task 1: Create branch

**Files:** None (git only)

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feature/mobile-friendly
```

- [ ] **Step 2: Verify branch**

```bash
git branch --show-current
```

Expected: `feature/mobile-friendly`

---

### Task 2: Add sidebarOpen state and hamburger button to ChatPage

**Files:**
- Modify: `src/components/ChatPage.tsx`
- Modify: `src/components/ChatSidebar.tsx` (props interface only)

- [ ] **Step 1: Add sidebarOpen state to ChatPage**

In `src/components/ChatPage.tsx`, add state after the existing state declarations (around line 36-50):

```tsx
const [sidebarOpen, setSidebarOpen] = useState(false);
```

- [ ] **Step 2: Update ChatSidebarProps interface**

In `src/components/ChatSidebar.tsx`, update the interface at lines 13-18:

```tsx
interface ChatSidebarProps {
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  refreshTrigger: number;
  isOpen: boolean;
  onClose: () => void;
}
```

- [ ] **Step 3: Update ChatSidebar function signature**

In `src/components/ChatSidebar.tsx`, update the destructured props at line 20-21:

```tsx
export default function ChatSidebar({
  activeConversationId,
  onSelectConversation,
  onNewChat,
  refreshTrigger,
  isOpen,
  onClose,
}: ChatSidebarProps) {
```

- [ ] **Step 4: Pass new props from ChatPage to ChatSidebar**

In `src/components/ChatPage.tsx`, update the `<ChatSidebar>` JSX at line 348:

```tsx
<ChatSidebar
  activeConversationId={conversationId}
  onSelectConversation={loadConversation}
  onNewChat={handleNewChat}
  refreshTrigger={refreshTrigger}
  isOpen={sidebarOpen}
  onClose={() => setSidebarOpen(false)}
/>
```

- [ ] **Step 5: Add hamburger button before the main content area**

In `src/components/ChatPage.tsx`, inside the `<div className="flex flex-1 flex-col">` (line 354), add a mobile header as the first child:

```tsx
<div className="flex items-center border-b border-gray-200 px-4 py-3 lg:hidden dark:border-gray-700">
  <button
    onClick={() => setSidebarOpen(true)}
    className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
    aria-label="Open sidebar"
  >
    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  </button>
  <span className="ml-3 text-sm font-medium text-gray-700 dark:text-gray-200">Conversations</span>
</div>
```

- [ ] **Step 6: Run build to verify no type errors**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ChatPage.tsx src/components/ChatSidebar.tsx
git commit -m "feat: add sidebarOpen state and hamburger button for mobile"
```

---

### Task 3: Make ChatSidebar responsive — overlay on mobile, static on desktop

**Files:**
- Modify: `src/components/ChatSidebar.tsx`

- [ ] **Step 1: Wrap the sidebar content with responsive overlay**

Replace the outer `<div>` at line 87:

Current:
```tsx
<div className="flex h-full w-64 flex-col border-r border-gray-200 bg-gray-50 dark:bg-gray-900 dark:border-gray-700">
```

Replace the entire return block with this structure — the sidebar content stays the same, but gets wrapped in overlay/backdrop for mobile:

```tsx
{/* Backdrop — only visible on mobile when open */}
{isOpen && (
  <div
    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
    onClick={onClose}
  />
)}

{/* Sidebar container */}
<div
  className={`
    fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-gray-50 transition-transform duration-200 ease-in-out dark:border-gray-700 dark:bg-gray-900
    lg:static lg:translate-x-0 lg:transition-none
    ${isOpen ? 'translate-x-0' : '-translate-x-full'}
  `}
>
```

Note: The closing `</div>` at the end of the component stays unchanged. The backdrop `<div>` is a sibling before the sidebar container. Wrap both in a fragment `<>...</>`.

- [ ] **Step 2: Add close button visible only on mobile**

Inside the sidebar, in the `<div className="p-4">` section (line 88), add a close button before the "New Chat" button:

```tsx
<div className="mb-2 flex items-center justify-between lg:hidden">
  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Conversations</span>
  <button
    onClick={onClose}
    className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
    aria-label="Close sidebar"
  >
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  </button>
</div>
```

- [ ] **Step 3: Close sidebar on conversation select**

In the conversation list `onClick` handler (around line 102-105), add `onClose()` after `onSelectConversation(conv.id)`:

```tsx
onClick={() => {
  onSelectConversation(conv.id);
  onClose();
}}
```

- [ ] **Step 4: Close sidebar on nav link clicks**

For each nav link in the footer section (Knowledge Graph, Settings, Dashboard, Admin links around lines 122-175), add `onClick={onClose}` to each `<a>` tag. For example:

```tsx
<a href="/knowledge" onClick={onClose} className="...">
```

Apply the same to Settings, Dashboard, Admin Users, and Admin Flags links.

- [ ] **Step 5: Close sidebar on New Chat click**

Update the New Chat button's onClick (around line 89-93):

```tsx
onClick={() => {
  onNewChat();
  onClose();
}}
```

- [ ] **Step 6: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/ChatSidebar.tsx
git commit -m "feat: responsive sidebar — overlay on mobile, static on desktop"
```

---

### Task 4: Responsive padding in ChatMessages

**Files:**
- Modify: `src/components/ChatMessages.tsx`

- [ ] **Step 1: Make the message container padding responsive**

At line 109, change:
```tsx
<div className="flex-1 overflow-y-auto p-6">
```
To:
```tsx
<div className="flex-1 overflow-y-auto p-3 lg:p-6">
```

- [ ] **Step 2: Make the empty-state container padding responsive**

At line 78, change:
```tsx
<div className="w-full max-w-2xl px-6">
```
To:
```tsx
<div className="w-full max-w-2xl px-3 lg:px-6">
```

- [ ] **Step 3: Make suggestion grid responsive**

At line 85, change:
```tsx
<div className="grid grid-cols-2 gap-3">
```
To:
```tsx
<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatMessages.tsx
git commit -m "feat: responsive padding and grid in ChatMessages"
```

---

### Task 5: Responsive padding in ChatInput

**Files:**
- Modify: `src/components/ChatInput.tsx`

- [ ] **Step 1: Make the input container padding responsive**

At line 126, change:
```tsx
<div className="border-t border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
```
To:
```tsx
<div className="border-t border-gray-200 bg-white p-2 lg:p-4 dark:border-gray-700 dark:bg-gray-900">
```

- [ ] **Step 2: Make the send button touch-friendly**

At line 186, change:
```tsx
className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
```
To:
```tsx
className="min-h-[44px] min-w-[44px] rounded-xl bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed lg:px-5 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
```

- [ ] **Step 3: Make the upload button touch-friendly**

At line 155, change:
```tsx
className="mb-1 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
```
To:
```tsx
className="mb-1 min-h-[44px] min-w-[44px] rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-300"
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatInput.tsx
git commit -m "feat: responsive padding and touch targets in ChatInput"
```

---

### Task 6: Responsive MessageBubble widths

**Files:**
- Modify: `src/components/MessageBubble.tsx`

- [ ] **Step 1: Make user bubble max-width responsive**

At line 27, change:
```tsx
<div className="max-w-[75%]">
```
To:
```tsx
<div className="max-w-[90%] lg:max-w-[75%]">
```

- [ ] **Step 2: Make user bubble image max dimensions responsive**

At line 40, change:
```tsx
className="max-h-[200px] max-w-[300px] rounded-xl border border-blue-400 object-contain"
```
To:
```tsx
className="max-h-[200px] max-w-[200px] rounded-xl border border-blue-400 object-contain lg:max-w-[300px]"
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/MessageBubble.tsx
git commit -m "feat: responsive bubble widths in MessageBubble"
```

---

### Task 7: Responsive ChatPage toolbar (flag/copy buttons)

**Files:**
- Modify: `src/components/ChatPage.tsx`

- [ ] **Step 1: Make toolbar padding responsive**

At line 376, change:
```tsx
<div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
```
To:
```tsx
<div className="flex items-center justify-between border-b border-gray-200 px-2 py-2 lg:px-4 dark:border-gray-700">
```

- [ ] **Step 2: Make the flag popup responsive**

At line 410, change:
```tsx
<div className="absolute right-0 top-full z-10 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-700 dark:bg-gray-800">
```
To:
```tsx
<div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg lg:w-72 dark:border-gray-700 dark:bg-gray-800">
```

- [ ] **Step 3: Make the link-account prompt padding responsive**

At line 356, change:
```tsx
<div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
```
To:
```tsx
<div className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:p-8">
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatPage.tsx
git commit -m "feat: responsive toolbar and prompt padding in ChatPage"
```

---

### Task 8: Touch target sizing for sidebar nav items

**Files:**
- Modify: `src/components/ChatSidebar.tsx`

- [ ] **Step 1: Ensure conversation list items have 44px min height**

At line 102, change:
```tsx
className={`group flex cursor-pointer items-center justify-between px-4 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
```
To:
```tsx
className={`group flex min-h-[44px] cursor-pointer items-center justify-between px-4 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
```

- [ ] **Step 2: Ensure nav link buttons have 44px min height**

For each nav link button in the footer (lines 125, 134, 144, 155, 170), add `min-h-[44px]` to their className. For example, line 125:

Change:
```tsx
className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
```
To:
```tsx
className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
```

Apply the same `min-h-[44px]` addition to all five nav link buttons at lines 134, 144, 155, 170.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatSidebar.tsx
git commit -m "feat: 44px touch targets for sidebar nav items"
```

---

### Task 9: Final verification

**Files:** None (testing only)

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Build succeeds with no errors or warnings.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Manual browser testing**

Start dev server and verify in browser devtools responsive mode:
- **375px (iPhone):** Sidebar hidden, hamburger shows, tapping opens overlay sidebar, selecting conversation closes it, messages use full width.
- **768px (tablet portrait):** Same as 375px — sidebar collapsed.
- **1024px (tablet landscape / small desktop):** Sidebar appears statically, hamburger hidden, normal desktop layout.
- **1440px (desktop):** Unchanged from current behavior.

- [ ] **Step 4: Commit any final fixes if needed**

```bash
git add -A
git commit -m "fix: final mobile polish adjustments"
```
