# Docker Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the app with Docker and docker-compose, with git/SSH support for private repo pulling.

**Architecture:** Multi-stage Dockerfile (deps → build → production) using node:20-alpine. Docker-compose orchestrates the single service with volume mounts for SQLite persistence and SSH keys. Entrypoint script runs Prisma migrations before starting the server.

**Tech Stack:** Docker, docker-compose, Node.js 20 Alpine, Prisma

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `Dockerfile` | Create | Multi-stage build for the Next.js app |
| `docker-compose.yml` | Create | Service definition, volumes, ports, env |
| `.dockerignore` | Create | Exclude unnecessary files from build context |
| `docker-entrypoint.sh` | Create | Run migrations then start server |

---

### Task 1: .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules
.next
.git
*.db
.env
.env.local
docs
__tests__
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "chore: add .dockerignore"
```

---

### Task 2: Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the Dockerfile**

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

RUN apk add --no-cache git openssh-client

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/docker-entrypoint.sh"]
```

**Note:** This requires Next.js standalone output mode. Task 3 will enable that.

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "chore: add Dockerfile with multi-stage build"
```

---

### Task 3: Enable Next.js standalone output

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Enable standalone output**

Change `next.config.ts` to:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

This makes Next.js produce a self-contained `standalone` folder that includes only the necessary server files and node_modules, enabling a smaller Docker image.

- [ ] **Step 2: Commit**

```bash
git add next.config.ts
git commit -m "chore: enable Next.js standalone output for Docker"
```

---

### Task 4: Entrypoint script

**Files:**
- Create: `docker-entrypoint.sh`

- [ ] **Step 1: Create the entrypoint**

```bash
#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting server..."
exec node server.js
```

- [ ] **Step 2: Commit**

```bash
git add docker-entrypoint.sh
git commit -m "chore: add Docker entrypoint with Prisma migrations"
```

---

### Task 5: docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ~/.ssh:/home/nextjs/.ssh:ro
    restart: unless-stopped
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add docker-compose.yml"
```

---

### Task 6: Build and verify

- [ ] **Step 1: Create data directory**

```bash
mkdir -p data
```

- [ ] **Step 2: Ensure DATABASE_URL in .env points to the volume**

Verify `.env` has:
```
DATABASE_URL="file:/app/data/prod.db"
```

- [ ] **Step 3: Build the Docker image**

```bash
docker compose build
```

Expected: Build completes successfully through all 3 stages.

- [ ] **Step 4: Start the container**

```bash
docker compose up -d
```

- [ ] **Step 5: Verify the app is running**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login
```

Expected: `200` (the login page loads)

- [ ] **Step 6: Verify git is available inside the container**

```bash
docker compose exec app git --version
```

Expected: `git version` output

- [ ] **Step 7: Stop the container**

```bash
docker compose down
```
