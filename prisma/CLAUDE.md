# prisma/

Prisma ORM configuration for PostgreSQL.

## Schema

- `User` — Auth users with roles (`"user"` | `"admin"`), encrypted Claude tokens
- `Conversation` — Chat conversations linked to users and repositories, with optional `claudeSessionId` for resuming
- `Message` — Chat messages (role: `"user"` | `"assistant"`) linked to conversations, with optional `sentByAdminId` and `seenByOwner` tracking
- `Attachment` — File uploads (images) linked to messages or feedback posts
- `KnowledgeEntry` — Knowledge pages with categories, tags, subject, pgvector embeddings (1024 dims), `kind` (`"derived"` | `"pinned"`), `status` (`"active"` | `"retired"`), and retrieval counters. Freshness is NOT stored; it is computed from `KnowledgeSource` blob hashes.
- `KnowledgeSource` — One row per (entry, gitlabProjectId, relative path): the git blob and commit the entry was verified against. Keyed by `gitlabProjectId`, not `Repository.id`, so provenance survives a repo being removed and re-added.
- `RepoSync` — One row per repo sync: from/to SHA, changed files, reason (`sync` | `branch_change` | `removed`), and `wouldStaleCount` (entries with a source among the changed files).
- `Flag` — Conversation flags from users with admin responses
- `FeedbackPost` — User-submitted feature requests and bug reports with status workflow (TODO → IN_PROGRESS → DONE)
- `Repository` — GitLab repository configurations (name, gitlabProjectId, localPath, active status)

## Conventions

- All models use UUID primary keys (`@id @default(uuid())`)
- Cascade deletes: Conversation -> Messages, User -> Conversations, Conversation -> Flags, User -> FeedbackPosts, Message -> Attachments
- Uses `@prisma/adapter-pg` (PrismaPg) for PostgreSQL connection
- pgvector extension for embedding similarity search (`Unsupported("vector(1024)")`)

## Migrations

Migrations are in `migrations/` with timestamp prefixes. Run `npx prisma migrate dev` to apply locally.
Production does not run these migrations: `docker-entrypoint.sh` applies the current `schema.prisma` with
`npx prisma db push --accept-data-loss` on every container start, so schema changes ship as edits to
`schema.prisma` itself rather than new migration files. Either way, after changing `schema.prisma` always
regenerate the client: `npx prisma generate`.
