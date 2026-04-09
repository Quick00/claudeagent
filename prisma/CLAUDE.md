# prisma/

Prisma ORM configuration for PostgreSQL.

## Schema

- `User` — Auth users with roles (`"user"` | `"admin"`), encrypted Claude tokens
- `Conversation` — Chat conversations linked to users, with optional `claudeSessionId` for resuming
- `Message` — Chat messages (role: `"user"` | `"assistant"`) linked to conversations
- `KnowledgeEntry` — Knowledge base entries with categories, tags, and pgvector embeddings (1024 dims)
- `Flag` — Conversation flags from users with admin responses

## Conventions

- All models use UUID primary keys (`@id @default(uuid())`)
- Cascade deletes: Conversation -> Messages, User -> Conversations, Conversation -> Flags
- Uses `@prisma/adapter-pg` (PrismaPg) for PostgreSQL connection
- pgvector extension for embedding similarity search (`Unsupported("vector(1024)")`)

## Migrations

Migrations are in `migrations/` with timestamp prefixes. Run `npx prisma migrate dev` to apply.
After changing schema.prisma, always generate the client: `npx prisma generate`.
