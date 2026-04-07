#!/bin/sh
set -e

# Ensure SSH known hosts exist for git operations
if [ -d "$HOME/.ssh" ] && [ ! -f "$HOME/.ssh/known_hosts" ]; then
  ssh-keyscan gitlab.com >> "$HOME/.ssh/known_hosts" 2>/dev/null
fi

echo "Syncing database schema..."
npx prisma db push

echo "Starting server..."
exec node server.js
