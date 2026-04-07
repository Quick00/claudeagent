# Claude Account Linking — Design Spec

## Overview

Each user must link their own Claude subscription (Max/Pro/Team) before using the chat. The app initiates an OAuth PKCE flow against Anthropic's OAuth endpoints, stores encrypted tokens per user, and passes them to the Claude CLI subprocess via `CLAUDE_CODE_OAUTH_TOKEN` env var.

## Motivation

Currently the app uses a single shared CLI authentication. This means one person pays for all usage. By requiring each user to link their own Claude account, usage is billed to their own subscription.

---

## Data Model

Add fields to the existing `User` model in Prisma:

```prisma
model User {
  // ... existing fields ...
  claudeToken          String?   // AES-256-GCM encrypted OAuth access token
  claudeRefreshToken   String?   // AES-256-GCM encrypted refresh token
  claudeTokenExpiresAt DateTime? // Token expiry timestamp
  claudeEmail          String?   // Claude account email (display only)
}
```

Users without a linked account (`claudeToken` is null) are blocked from chatting.

---

## OAuth Flow

### Endpoints

- **Authorize:** `https://claude.ai/oauth/authorize`
- **Token:** `https://console.anthropic.com/v1/oauth/token`
- **Client ID:** `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (Anthropic's first-party Claude Code client)
- **Scope:** `user:inference`
- **PKCE:** SHA-256 code challenge

### Linking Flow

1. User clicks "Link Claude Account" (settings page or chat blocking state)
2. `GET /api/auth/claude/` — server generates:
   - PKCE code verifier (random 128 bytes, base64url)
   - PKCE code challenge (SHA-256 of verifier, base64url)
   - OAuth state parameter (random, for CSRF protection)
   - Stores code verifier + state in encrypted HTTP-only cookie (short-lived, 10 min)
3. Server redirects user to:
   ```
   https://claude.ai/oauth/authorize?
     client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e
     &response_type=code
     &code_challenge=<challenge>
     &code_challenge_method=S256
     &redirect_uri=<NEXTAUTH_URL>/api/auth/claude/callback
     &state=<state>
     &scope=user:inference
   ```
4. User logs into Claude, authorizes
5. Anthropic redirects to `/api/auth/claude/callback?code=...&state=...`
6. Server validates state, exchanges code for tokens:
   ```
   POST https://console.anthropic.com/v1/oauth/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code
   &code=<auth_code>
   &redirect_uri=<same as above>
   &client_id=<client_id>
   &code_verifier=<verifier>
   ```
7. Response contains `access_token`, `refresh_token`, `expires_in`
8. Server encrypts tokens with AES-256-GCM, stores on user record
9. Server extracts Claude email from token (if available in response/claims) or stores a placeholder
10. User redirected to chat page with success

### Unlinking Flow

- `POST /api/auth/claude/unlink` — clears `claudeToken`, `claudeRefreshToken`, `claudeTokenExpiresAt`, `claudeEmail` on user record
- User redirected to settings or shown confirmation

### Token Refresh

- Before spawning CLI, check `claudeTokenExpiresAt`
- If expired (or within 5 min of expiry), refresh:
  ```
  POST https://console.anthropic.com/v1/oauth/token
  Content-Type: application/x-www-form-urlencoded

  grant_type=refresh_token
  &refresh_token=<decrypted_refresh_token>
  &client_id=<client_id>
  ```
- Store new access token + refresh token (rotation)
- If refresh fails (e.g., token revoked), clear user's tokens and return error prompting re-link

---

## API Routes

### `GET /api/auth/claude/`
- Requires authenticated session (NextAuth)
- Generates PKCE + state, stores in cookie
- Redirects to Anthropic authorize URL

### `GET /api/auth/claude/callback`
- Validates state parameter against cookie
- Exchanges auth code for tokens
- Encrypts and stores tokens on user record
- Clears PKCE cookie
- Redirects to `/` with success query param

### `POST /api/auth/claude/unlink`
- Requires authenticated session
- Clears all Claude token fields on user record
- Returns 200

### `GET /api/auth/claude/status`
- Requires authenticated session
- Returns `{ linked: boolean, email: string | null }`
- Never returns tokens

---

## Session Manager Changes

### `src/lib/session-manager.ts`

Current: spawns `claude` CLI with no per-user auth.

Changes:
- `sendMessage()` accepts a `claudeToken: string` parameter (already decrypted)
- Token passed as `CLAUDE_CODE_OAUTH_TOKEN` env var on the child process:
  ```typescript
  const childProcess = spawn('claude', [...args], {
    env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: userToken }
  })
  ```
- If no token provided, reject with an error (never spawn without a user token)
- Remove any reliance on global/shared CLI authentication for chat sessions

---

## Chat API Changes

### `POST /api/chat`

Current flow: authenticate user, fetch knowledge, spawn CLI.

Added steps:
1. After authenticating user, fetch user record including `claudeToken`, `claudeTokenExpiresAt`, `claudeRefreshToken`
2. If no `claudeToken` → return 403 with `{ error: "claude_account_not_linked" }`
3. If token expired → attempt refresh (see Token Refresh above)
4. If refresh fails → return 403 with `{ error: "claude_token_expired" }`
5. Decrypt token, pass to session manager

---

## Encryption

### `src/lib/crypto.ts`

- AES-256-GCM encryption/decryption
- Key derived from `TOKEN_ENCRYPTION_KEY` env var (32-byte hex or base64)
- Each encrypted value stores: IV (12 bytes) + ciphertext + auth tag (16 bytes), encoded as base64
- Functions: `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string`

---

## UI Changes

### Chat Page (`/`)

- If user's Claude account is not linked:
  - Hide chat input
  - Show centered message: "Link your Claude account to start asking questions"
  - Show "Link Claude Account" button that navigates to `/api/auth/claude/`
- If linked: no changes, chat works as normal

### Sidebar (`ChatSidebar.tsx`)

- Add a settings/account link (gear icon or "Settings" text) near the user info area
- Links to a new settings page

### Settings Page (`/settings`) — New

- Simple page showing:
  - **Claude Account** section
    - If linked: shows Claude email, green "Connected" badge, "Unlink" button
    - If not linked: shows "Not connected" status, "Link Claude Account" button
- Minimal — not a full settings system, just the account linking

### Login Page

- No changes. Google OAuth remains the app login mechanism.

---

## Environment Variables

New required variable:

```
TOKEN_ENCRYPTION_KEY=<64-char hex string or 32-byte base64>
```

Generate with: `openssl rand -hex 32`

---

## Error Handling

| Scenario | Behavior |
|---|---|
| OAuth callback with invalid state | Redirect to settings with `?error=invalid_state` |
| Token exchange fails | Redirect to settings with `?error=token_exchange_failed` |
| Token refresh fails | Clear tokens, return 403 from chat API |
| User tries to chat without linked account | Return 403, client shows linking prompt |
| Encryption key missing | App fails to start (checked at boot) |

---

## Out of Scope

- Per-user usage tracking/billing dashboard
- Multiple Claude accounts per user
- Admin ability to link accounts on behalf of users
- Migration path for existing conversations (they continue to work once user links)
