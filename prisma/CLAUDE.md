# prisma/

Prisma ORM configuration for PostgreSQL.

## Schema

- `User` — Auth users with roles (`"user"` | `"admin"`), encrypted Claude tokens
- `Conversation` — Chat conversations linked to users and repositories, with optional `claudeSessionId` for resuming
- `Message` — Chat messages (role: `"user"` | `"assistant"`) linked to conversations, with optional `sentByAdminId` and `seenByOwner` tracking
- `Attachment` — File uploads (images) linked to messages or feedback posts
- `KnowledgeEntry` — Knowledge base entries with categories, tags, subject, and pgvector embeddings (1024 dims)
- `Flag` — Conversation flags from users with admin responses
- `FeedbackPost` — User-submitted feature requests and bug reports with status workflow (TODO → IN_PROGRESS → DONE)
- `Repository` — GitLab repository configurations (name, gitlabProjectId, localPath, active status)

## Conventions

- All models use UUID primary keys (`@id @default(uuid())`)
- Cascade deletes: Conversation -> Messages, User -> Conversations, Conversation -> Flags, User -> FeedbackPosts, Message -> Attachments
- Uses `@prisma/adapter-pg` (PrismaPg) for PostgreSQL connection
- pgvector extension for embedding similarity search (`Unsupported("vector(1024)")`)

## Migrations

Migrations are in `migrations/` with timestamp prefixes. Run `npx prisma migrate dev` to apply.
After changing schema.prisma, always generate the client: `npx prisma generate`.
