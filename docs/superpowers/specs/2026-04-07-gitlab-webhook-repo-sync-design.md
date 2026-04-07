# Webhook-Triggered Repo Sync

## Overview

A single API endpoint that receives GitLab push webhooks and runs `git pull` on the repo inside the Docker container. This keeps the codebase the app analyzes up-to-date in real-time without polling.

## Components

### 1. Webhook endpoint — `POST /api/webhook/gitlab`

- Validates the `X-Gitlab-Token` header against `GITLAB_WEBHOOK_SECRET`
- Runs `git pull` via `child_process.exec` on the path configured in `REPO_PATH`
- Returns 200 on success, 500 on pull failure
- No NextAuth session required — secured by webhook secret only, so GitLab can reach it
- Simple lock (in-memory flag) to prevent overlapping pulls if multiple pushes arrive quickly

### 2. Environment config

| Variable | Purpose |
|---|---|
| `GITLAB_WEBHOOK_SECRET` | Shared secret configured in both GitLab and the app |
| `REPO_PATH` | Path to the cloned repo inside the container (already exists) |

### 3. Middleware update

Add `/api/webhook/gitlab` to public routes in `src/proxy.ts` so it bypasses JWT authentication.

### 4. Docker setup

- SSH key mounted as a volume or Docker secret for private repo access
- Repo is manually cloned inside the container before first use
- `REPO_PATH` points to the cloned repo inside the container

## Error handling

| Scenario | Response |
|---|---|
| Missing or invalid webhook secret | 401 Unauthorized |
| `git pull` fails (merge conflict, network issue) | 500 with error logged to server console |
| Concurrent webhook requests | Second request returns 409 (pull already in progress) |

## Out of scope

- No admin UI for pull status
- No scheduled polling / interval-based pull
- No automatic clone on startup
- No GitLab OAuth integration
