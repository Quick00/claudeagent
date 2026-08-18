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

echo "Syncing database schema..."
su-exec nextjs npx prisma db push --accept-data-loss

echo "Starting server..."
exec su-exec nextjs node server.js
