#!/bin/sh
set -e

# Fix ownership of repos directory and mark safe for git
if [ -d "${REPOS_DIR:-/app/repos}" ]; then
  chown -R nextjs:nodejs "${REPOS_DIR:-/app/repos}"
  git config --global --add safe.directory '*'
fi

# Ensure uploads directory exists and is writable
mkdir -p /app/uploads
chown -R nextjs:nodejs /app/uploads

# Replay the migration history rather than `prisma db push --accept-data-loss`.
# Push diffs the live database against schema.prisma and silently drops
# whatever it cannot find there — which included the HNSW index on
# KnowledgeEntry.embedding, since the column is `Unsupported("vector(1024)")`
# and Prisma cannot represent its index. Every deploy therefore removed the
# index serving the `ORDER BY embedding <=> $vector` searches in
# src/lib/embeddings.ts, and no migration could put it back because push
# never reads prisma/migrations at all.
#
# `set -e` means a failed migration stops the container instead of starting
# the app against a schema that does not match. That is the point: push could
# not fail, it just destroyed things. If this aborts, read the error before
# reaching for `db push` — a schema change committed without a migration file
# is the usual cause, and `prisma migrate status` names what is pending.
echo "Applying database migrations..."
su-exec nextjs npx prisma migrate deploy

echo "Starting server..."
exec su-exec nextjs node server.js
