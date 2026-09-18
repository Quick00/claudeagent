# prisma/

Prisma ORM configuration for PostgreSQL.

## Schema

- `User` — Auth users with roles (`"user"` | `"admin"`), encrypted Claude tokens
- `Conversation` — Chat conversations linked to users and repositories, with optional `claudeSessionId` for resuming
- `Message` — Chat messages (role: `"user"` | `"assistant"`) linked to conversations, with optional `sentByAdminId` and `seenByOwner` tracking
- `Attachment` — File uploads (images) linked to messages or feedback posts
- `KnowledgeEntry` — Knowledge pages with categories, tags, subject, pgvector embeddings (1024 dims), `kind` (`"derived"` | `"pinned"`), `status` (`"active"` | `"retired"`), and retrieval counters. Freshness is NOT stored; it is computed from `KnowledgeSource` blob hashes.
- `KnowledgeSource` — One row per (entry, gitlabProjectId, relative path): the git blob and commit the entry was verified against. Keyed by `gitlabProjectId`, not `Repository.id`, so provenance survives a repo being removed and re-added.
- `RepoSync` — One row per repo sync: from/to SHA, changed files (a rename is recorded as `old -> new`), reason (`sync` | `branch_change` | `removed`), and `wouldStaleCount` (entries with a source among the changed files; renames are excluded, the file moved but its content did not).
- `KnowledgeReview` — A decision an admin must make about an entry: `pinned_conflict` (Claude found code contradicting a pinned rule), `supersedes` (a fresh page landed next to a stale one), `proposed_update` (tier 1 verifier suggests new content). `payload` is type-specific JSON.
- `VerificationRun` — One row per verification attempt (tier 1 Haiku or tier 2 Claude Code), with outcome, cost, and duration.
- `Flag` — Conversation flags from users with admin responses
- `FeedbackPost` — User-submitted feature requests and bug reports with status workflow (TODO → IN_PROGRESS → DONE)
- `Repository` — GitLab repository configurations (name, gitlabProjectId, localPath, active status)

## Conventions

- All models use UUID primary keys (`@id @default(uuid())`)
- Cascade deletes: Conversation -> Messages, User -> Conversations, Conversation -> Flags, User -> FeedbackPosts, Message -> Attachments, KnowledgeEntry -> KnowledgeSource, KnowledgeEntry -> KnowledgeReview, KnowledgeEntry -> VerificationRun
- Uses `@prisma/adapter-pg` (PrismaPg) for PostgreSQL connection
- pgvector extension for embedding similarity search (`Unsupported("vector(1024)")`)

## Migrations

Migrations are in `migrations/` with timestamp prefixes. Run `npx prisma migrate dev` to apply locally.
`docker-entrypoint.sh` runs `npx prisma migrate deploy` on every container start, so a schema change ships
as an edit to `schema.prisma` **and** a migration file — without one, the column never reaches production.
Write the SQL so replaying it is harmless (`ADD COLUMN IF NOT EXISTS`, `to_regclass` guards): a database
predating `migrate deploy` was synced with `db push` and may already hold the change, and one migration
recorded as failed blocks every later deploy. After changing `schema.prisma` always regenerate the client:
`npx prisma generate`.
