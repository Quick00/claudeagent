# Admin Role: View All Users

## Overview

Add an admin role to the application so designated users can view a list of all registered users. Admin status is assigned by setting a `role` field directly in the database.

## Schema Change

Add a `role` field to the `User` model in `prisma/schema.prisma`:

```prisma
model User {
  id                   String    @id @default(uuid())
  email                String    @unique
  name                 String
  image                String?
  claudeToken          String?
  claudeEmail          String?
  role                 String    @default("user") // "user" or "admin"
  createdAt            DateTime  @default(now())
  conversations        Conversation[]
}
```

A Prisma migration adds the column with default `"user"` so existing users are unaffected.

## Session Enrichment

The NextAuth `session` callback in `src/lib/auth.ts` already fetches the DB user. Add `role` to the session object so it's available client-side and server-side without extra queries.

Extend the session type so `session.user.role` is typed (via NextAuth module augmentation or inline cast).

## API Route

`GET /api/admin/users` — returns all users (id, name, email, image, role, createdAt, claudeEmail presence).

- Requires authenticated session with `role === "admin"`.
- Returns 403 if the user is not an admin.
- Does **not** return sensitive fields (claudeToken).

## Admin Page

`/admin/users` — server-rendered or client page that fetches from the API and displays a table:

| Column | Source |
|---|---|
| Name | `user.name` |
| Email | `user.email` |
| Role | `user.role` |
| Claude Linked | `!!user.claudeEmail` |
| Joined | `user.createdAt` |

Protected: redirects to `/` (or shows 403) if the user is not an admin.

Styled consistently with the existing settings page (Tailwind, same card/layout patterns).

## Making Someone Admin

Run directly in the database:

```sql
UPDATE "User" SET role = 'admin' WHERE email = 'admin@example.com';
```

Or via Prisma Studio / a one-off script. No UI for role assignment.

## Out of Scope

- User management (edit, delete, disable)
- Role assignment UI
- Pagination or search (can add later if user count grows)
- Middleware-based route protection (page-level checks are sufficient for one protected route)
