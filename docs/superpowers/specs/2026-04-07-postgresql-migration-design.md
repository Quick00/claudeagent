# Switch from SQLite to PostgreSQL

## Overview

Replace SQLite with PostgreSQL as the database. Add a Postgres container to docker-compose. No application code changes — only Prisma config, dependencies, and Docker infrastructure.

## Changes

### Prisma schema

Change `datasource db` provider from `"sqlite"` to `"postgresql"`. No model changes needed.

### Dependencies

- Remove: `@prisma/adapter-better-sqlite3`, `better-sqlite3`
- No new runtime dependencies — Prisma's PostgreSQL driver is built-in

### Docker

- Add `postgres` service to `docker-compose.yml` with named volume for data
- Remove `./data:/app/data` bind mount (no SQLite file)
- Remove `better-sqlite3` COPY line from Dockerfile
- App service gets `depends_on: postgres`
- `DATABASE_URL` becomes `postgresql://user:password@postgres:5432/claude_agent`

### Migrations

- Delete existing SQLite migrations
- Create fresh initial migration for PostgreSQL

### .env.example

- Update `DATABASE_URL` example to PostgreSQL connection string

## Out of scope

- No application code changes (Prisma client API is provider-agnostic)
- No test changes (tests mock Prisma)
