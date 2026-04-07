# PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SQLite with PostgreSQL — update Prisma, dependencies, application code, and Docker config.

**Architecture:** Switch the Prisma datasource provider to `postgresql`, remove the SQLite adapter from application code, add a Postgres container to docker-compose, and create a fresh migration.

**Tech Stack:** Prisma, PostgreSQL, Docker

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Change provider to postgresql |
| `src/lib/prisma.ts` | Modify | Remove SQLite adapter, use plain PrismaClient |
| `package.json` | Modify | Remove SQLite dependencies |
| `Dockerfile` | Modify | Remove better-sqlite3 copy, remove data dir |
| `docker-compose.yml` | Modify | Add postgres service, remove data volume |
| `.env.example` | Modify | Update DATABASE_URL example |
| `prisma/migrations/` | Delete & recreate | Fresh PostgreSQL migration |

---

### Task 1: Remove SQLite dependencies and update Prisma schema

**Files:**
- Modify: `prisma/schema.prisma:5-7`
- Modify: `package.json` (remove deps)

- [ ] **Step 1: Update Prisma schema provider**

Change `prisma/schema.prisma` datasource block from:
```prisma
datasource db {
  provider = "sqlite"
}
```
to:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 2: Remove SQLite packages**

```bash
npm uninstall @prisma/adapter-better-sqlite3 better-sqlite3
```

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma package.json package-lock.json
git commit -m "chore: switch Prisma provider to postgresql, remove SQLite deps"
```

---

### Task 2: Update Prisma client initialization

**Files:**
- Modify: `src/lib/prisma.ts`

- [ ] **Step 1: Replace SQLite adapter with plain PrismaClient**

Replace the entire contents of `src/lib/prisma.ts` with:

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Run tests to verify nothing breaks**

```bash
npx jest --no-cache
```

Expected: All tests pass (tests mock Prisma, not the database)

- [ ] **Step 3: Commit**

```bash
git add src/lib/prisma.ts
git commit -m "refactor: use plain PrismaClient instead of SQLite adapter"
```

---

### Task 3: Create fresh PostgreSQL migration

**Files:**
- Delete: `prisma/migrations/` (all existing SQLite migrations)
- Create: new initial migration

- [ ] **Step 1: Delete existing SQLite migrations**

```bash
rm -rf prisma/migrations
```

- [ ] **Step 2: Generate Prisma client for PostgreSQL**

```bash
npx prisma generate
```

- [ ] **Step 3: Commit**

```bash
git add -A prisma/migrations prisma/schema.prisma
git commit -m "chore: remove SQLite migrations, regenerate Prisma client for PostgreSQL"
```

Note: The actual migration will be created at first deploy by `prisma migrate deploy` in the entrypoint, or you can run `npx prisma migrate dev --name init` locally with a running PostgreSQL instance.

---

### Task 4: Update Docker configuration

**Files:**
- Modify: `Dockerfile:28,34`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Update Dockerfile**

Remove the `better-sqlite3` COPY line (line 28):
```dockerfile
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
```

Remove the data directory creation (line 34):
```dockerfile
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
```

- [ ] **Step 2: Update docker-compose.yml**

Replace the entire file with:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: claude_agent
      POSTGRES_PASSWORD: claude_agent
      POSTGRES_DB: claude_agent
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - repo:/app/repo
      - ~/.ssh:/home/nextjs/.ssh:ro
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  pgdata:
  repo:
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add PostgreSQL container, remove SQLite from Docker"
```

---

### Task 5: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update DATABASE_URL**

Change:
```
DATABASE_URL="file:./dev.db"
```
to:
```
DATABASE_URL="postgresql://claude_agent:claude_agent@localhost:5432/claude_agent"
```

Add a comment noting the Docker internal URL:
```
# In Docker: postgresql://claude_agent:claude_agent@postgres:5432/claude_agent
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update DATABASE_URL to PostgreSQL in env example"
```

---

### Task 6: Run tests and verify

- [ ] **Step 1: Run full test suite**

```bash
npx jest --no-cache
```

Expected: All tests pass, no regressions.
