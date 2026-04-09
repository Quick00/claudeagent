# Featurebase Feedback Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Featurebase feedback widget to the sidebar so all authenticated users can submit feature requests and bug reports.

**Architecture:** A single `FeedbackWidget` client component loads the Featurebase JS SDK via `next/script` with `lazyOnload` strategy, initializes it with session user data, and renders a sidebar button that manually triggers the popup. The component is placed inside `ChatSidebar.tsx` alongside existing nav items.

**Tech Stack:** Next.js 16 `next/script`, NextAuth.js `useSession`, Featurebase JS SDK, Jest + React Testing Library

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/FeedbackWidget.tsx` | Create | Client component: loads SDK, initializes with user data, renders sidebar button |
| `src/components/__tests__/FeedbackWidget.test.tsx` | Create | Unit tests for the component |
| `src/components/ChatSidebar.tsx` | Modify | Import and render `FeedbackWidget` in the nav section |
| `.env.example` | Modify | Add `NEXT_PUBLIC_FEATUREBASE_ORG` |

---

### Task 1: Create FeedbackWidget Component with Tests

**Files:**
- Create: `src/components/__tests__/FeedbackWidget.test.tsx`
- Create: `src/components/FeedbackWidget.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/FeedbackWidget.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import FeedbackWidget from '../FeedbackWidget';

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

// Mock next/script — render as a div and call onReady synchronously
jest.mock('next/script', () => {
  return function MockScript(props: any) {
    if (props.onReady) {
      props.onReady();
    }
    return <div data-testid="mock-script" data-src={props.src} data-strategy={props.strategy} />;
  };
});

import { useSession } from 'next-auth/react';

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;

describe('FeedbackWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up any global Featurebase mock
    delete (window as any).Featurebase;
  });

  it('renders the Feedback button', () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);
    expect(screen.getByText('Feedback')).toBeDefined();
  });

  it('loads the Featurebase SDK script with lazyOnload strategy', () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);
    const script = screen.getByTestId('mock-script');
    expect(script.getAttribute('data-src')).toBe('https://do.featurebase.app/js/sdk.js');
    expect(script.getAttribute('data-strategy')).toBe('lazyOnload');
  });

  it('initializes Featurebase with user data when SDK loads', () => {
    const mockFeaturebase = jest.fn();
    (window as any).Featurebase = mockFeaturebase;

    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    process.env.NEXT_PUBLIC_FEATUREBASE_ORG = 'test-org';

    render(<FeedbackWidget />);

    expect(mockFeaturebase).toHaveBeenCalledWith('initialize_feedback_widget', expect.objectContaining({
      organization: 'test-org',
      email: 'test@example.com',
      name: 'Test User',
      placement: 'manual',
    }));
  });

  it('calls Featurebase to open widget on button click', () => {
    const mockFeaturebase = jest.fn();
    (window as any).Featurebase = mockFeaturebase;

    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);
    mockFeaturebase.mockClear();

    fireEvent.click(screen.getByText('Feedback'));

    expect(mockFeaturebase).toHaveBeenCalledWith('manually_open_feedback_widget');
  });

  it('renders button even when session is loading', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'loading',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);
    expect(screen.getByText('Feedback')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern='FeedbackWidget' --no-coverage`

Expected: FAIL — `Cannot find module '../FeedbackWidget'`

- [ ] **Step 3: Write the FeedbackWidget component**

Create `src/components/FeedbackWidget.tsx`:

```tsx
'use client';

import Script from 'next/script';
import { useSession } from 'next-auth/react';

declare global {
  interface Window {
    Featurebase: (...args: any[]) => void;
  }
}

export default function FeedbackWidget() {
  const { data: session } = useSession();

  const handleReady = () => {
    if (typeof window.Featurebase !== 'function') return;

    window.Featurebase('initialize_feedback_widget', {
      organization: process.env.NEXT_PUBLIC_FEATUREBASE_ORG,
      placement: 'manual',
      email: session?.user?.email ?? undefined,
      name: session?.user?.name ?? undefined,
    });
  };

  const handleClick = () => {
    if (typeof window.Featurebase === 'function') {
      window.Featurebase('manually_open_feedback_widget');
    }
  };

  return (
    <>
      <Script
        id="featurebase-sdk"
        src="https://do.featurebase.app/js/sdk.js"
        strategy="lazyOnload"
        onReady={handleReady}
      />
      <button
        onClick={handleClick}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
        Feedback
      </button>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --testPathPattern='FeedbackWidget' --no-coverage`

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/FeedbackWidget.tsx src/components/__tests__/FeedbackWidget.test.tsx
git commit -m "feat: add FeedbackWidget component with Featurebase SDK integration"
```

---

### Task 2: Integrate FeedbackWidget into ChatSidebar

**Files:**
- Modify: `src/components/ChatSidebar.tsx:75-114` (the bottom nav section)

- [ ] **Step 1: Write a test for FeedbackWidget presence in sidebar**

Append to `src/components/__tests__/FeedbackWidget.test.tsx`:

```tsx
// At the top of the file, add this import:
import ChatSidebar from '../ChatSidebar';

// Add to the describe block or create a new one:
describe('ChatSidebar feedback integration', () => {
  it('renders the FeedbackWidget in the sidebar', () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(
      <ChatSidebar
        activeConversationId={null}
        onSelectConversation={jest.fn()}
        onNewChat={jest.fn()}
        refreshTrigger={0}
      />
    );

    expect(screen.getByText('Feedback')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --testPathPattern='FeedbackWidget' --no-coverage`

Expected: FAIL — "Feedback" text not found in ChatSidebar output

- [ ] **Step 3: Add FeedbackWidget to ChatSidebar**

In `src/components/ChatSidebar.tsx`, add the import at the top (after existing imports):

```tsx
import FeedbackWidget from './FeedbackWidget';
```

Then add the `<FeedbackWidget />` element in the bottom nav section (between the Settings link and the closing `</div>` of the nav area), at line 114:

```tsx
        <FeedbackWidget />
```

The modified section (lines 105-115) should look like:

```tsx
        <a
          href="/settings"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 hover:bg-gray-200"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Settings
        </a>
        <FeedbackWidget />
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --testPathPattern='FeedbackWidget' --no-coverage`

Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatSidebar.tsx src/components/__tests__/FeedbackWidget.test.tsx
git commit -m "feat: add Feedback button to ChatSidebar"
```

---

### Task 3: Add Environment Variable to .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add the Featurebase env var to .env.example**

Append to the end of `.env.example`:

```
# Featurebase feedback widget
NEXT_PUBLIC_FEATUREBASE_ORG=your-featurebase-org
```

- [ ] **Step 2: Verify the file looks correct**

Run: `cat .env.example | tail -5`

Expected: The last lines show the new Featurebase variable.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add NEXT_PUBLIC_FEATUREBASE_ORG to .env.example"
```

---

### Task 4: Manual Verification

- [ ] **Step 1: Run the full test suite**

Run: `npm test -- --no-coverage`

Expected: All tests pass, no regressions.

- [ ] **Step 2: Run the build**

Run: `npm run build`

Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual smoke test (optional)**

Set `NEXT_PUBLIC_FEATUREBASE_ORG` to your Featurebase org slug in `.env.local`, run `npm run dev`, log in, and verify:
1. "Feedback" button appears in the sidebar below "Settings"
2. Clicking it opens the Featurebase popup
3. Your name/email are pre-filled
