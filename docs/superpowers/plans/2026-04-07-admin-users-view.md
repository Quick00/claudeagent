# Admin Users View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin role and a view-only admin page that lists all registered users.

**Architecture:** Add a `role` column to the User model, expose the role in the NextAuth session, create a protected API route to list users, and a client page to display them in a table.

**Tech Stack:** Prisma (migration), NextAuth (session enrichment), Next.js App Router (API route + page), Tailwind CSS, Jest (API test)

---

### Task 1: Add `role` column to User model

**Files:**
- Modify: `prisma/schema.prisma:9-18`

- [ ] **Step 1: Add role field to User model**

In `prisma/schema.prisma`, add the `role` field to the `User` model after `claudeEmail`:

```prisma
model User {
  id                   String    @id @default(uuid())
  email                String    @unique
  name                 String
  image                String?
  claudeToken          String?
  claudeEmail          String?
  role                 String    @default("user")
  createdAt            DateTime  @default(now())
  conversations        Conversation[]
}
```

- [ ] **Step 2: Generate and run migration**

Run:
```bash
npx prisma migrate dev --name add-user-role
```

Expected: Migration created and applied. All existing users get `role = "user"` by default.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add role column to User model"
```

---

### Task 2: Expose role in NextAuth session

**Files:**
- Modify: `src/lib/auth.ts:73-83`

- [ ] **Step 1: Add role to session callback**

In `src/lib/auth.ts`, update the `session` callback to include the user's role. Replace the existing session callback:

```typescript
    async session({ session, token }) {
      if (session.user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: session.user.email },
        });
        if (dbUser) {
          (session.user as any).id = dbUser.id;
          (session.user as any).role = dbUser.role;
        }
      }
      return session;
    },
```

The only change is adding `(session.user as any).role = dbUser.role;` after the id line.

- [ ] **Step 2: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: expose user role in NextAuth session"
```

---

### Task 3: Create admin users API route

**Files:**
- Create: `src/app/api/admin/users/route.ts`
- Create: `__tests__/api/admin-users.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin-users.test.ts`:

```typescript
import { GET } from '@/app/api/admin/users/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

const mockGetServerSession = getServerSession as jest.Mock;
const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockFindMany = prisma.user.findMany as jest.Mock;

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'user@example.com' },
    });
    mockFindUnique.mockResolvedValue({
      id: '1',
      email: 'user@example.com',
      role: 'user',
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it('returns user list when user is admin', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { email: 'admin@example.com' },
    });
    mockFindUnique.mockResolvedValue({
      id: '1',
      email: 'admin@example.com',
      role: 'admin',
    });
    const users = [
      {
        id: '1',
        name: 'Admin',
        email: 'admin@example.com',
        image: null,
        role: 'admin',
        claudeEmail: 'claude@example.com',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        name: 'Regular User',
        email: 'user@example.com',
        image: null,
        role: 'user',
        claudeEmail: null,
        createdAt: new Date('2026-02-01'),
      },
    ];
    mockFindMany.mockResolvedValue(users);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({
      id: '1',
      name: 'Admin',
      email: 'admin@example.com',
      image: null,
      role: 'admin',
      claudeLinked: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(data[1].claudeLinked).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest __tests__/api/admin-users.test.ts`
Expected: FAIL — module `@/app/api/admin/users/route` not found.

- [ ] **Step 3: Implement the API route**

Create `src/app/api/admin/users/route.ts`:

```typescript
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!currentUser || currentUser.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      claudeEmail: true,
      createdAt: true,
    },
  });

  const result = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    role: user.role,
    claudeLinked: !!user.claudeEmail,
    createdAt: user.createdAt,
  }));

  return NextResponse.json(result);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest __tests__/api/admin-users.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/users/route.ts __tests__/api/admin-users.test.ts
git commit -m "feat: add admin users API route with tests"
```

---

### Task 4: Create admin users page

**Files:**
- Create: `src/app/admin/users/page.tsx`

- [ ] **Step 1: Create the admin users page**

Create `src/app/admin/users/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';

interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  claudeLinked: boolean;
  createdAt: string;
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => {
        if (res.status === 403) {
          setError('Forbidden');
          return [];
        }
        if (!res.ok) throw new Error('Failed to fetch users');
        return res.json();
      })
      .then(setUsers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (status === 'loading' || loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  if (error === 'Forbidden') {
    redirect('/');
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-4xl rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-6 text-xl font-bold text-gray-900">Users</h1>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-gray-500">
                <th className="pb-3 pr-4 font-medium">Name</th>
                <th className="pb-3 pr-4 font-medium">Email</th>
                <th className="pb-3 pr-4 font-medium">Role</th>
                <th className="pb-3 pr-4 font-medium">Claude</th>
                <th className="pb-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-gray-100">
                  <td className="py-3 pr-4 text-gray-900">{user.name}</td>
                  <td className="py-3 pr-4 text-gray-500">{user.email}</td>
                  <td className="py-3 pr-4">
                    <span
                      className={
                        user.role === 'admin'
                          ? 'rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700'
                          : 'rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600'
                      }
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={
                        user.claudeLinked
                          ? 'inline-block h-2 w-2 rounded-full bg-green-500'
                          : 'inline-block h-2 w-2 rounded-full bg-gray-300'
                      }
                    />
                  </td>
                  <td className="py-3 text-gray-500">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4">
          <a href="/" className="text-sm text-blue-600 hover:text-blue-700">
            &larr; Back to chat
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the page renders**

Run: `npx next build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/users/page.tsx
git commit -m "feat: add admin users page"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start the dev server and test**

Run: `npm run dev`

1. Log in as a regular user, navigate to `/admin/users` — should redirect to `/`.
2. In the database, set your user's role to admin:
   ```sql
   UPDATE "User" SET role = 'admin' WHERE email = 'your@email.com';
   ```
3. Refresh `/admin/users` — should display the users table.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address issues from manual testing"
```
