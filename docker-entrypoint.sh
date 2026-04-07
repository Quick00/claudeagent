#!/bin/sh
set -e

# Fix ownership of mounted volumes
chown -R nextjs:nodejs /app/repo

# Ensure SSH known hosts exist for git operations
if [ -d /home/nextjs/.ssh ] && [ ! -f /home/nextjs/.ssh/known_hosts ]; then
  su-exec nextjs ssh-keyscan gitlab.com >> /home/nextjs/.ssh/known_hosts 2>/dev/null
fi

echo "Syncing database schema..."
su-exec nextjs npx prisma db push

echo "Starting server..."
exec su-exec nextjs node server.js
