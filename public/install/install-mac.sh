#!/usr/bin/env bash
set -euo pipefail

echo "==> Installing Claude Code..."
curl -fsSL https://claude.ai/install.sh | bash

CLAUDE_BIN="$HOME/.local/bin/claude"
if [ ! -x "$CLAUDE_BIN" ]; then
  echo ""
  echo "ERROR: install finished but $CLAUDE_BIN is missing."
  echo "Please visit https://code.claude.com/docs/en/quickstart for help."
  exit 1
fi

echo ""
echo "==> Claude Code installed: $("$CLAUDE_BIN" --version)"
echo ""
echo "==> Generating your setup token..."
echo "    A browser window will open. Log in with your Claude account."
echo "    After authorizing, copy the token printed below and paste it"
echo "    back into the app."
echo ""
"$CLAUDE_BIN" setup-token
