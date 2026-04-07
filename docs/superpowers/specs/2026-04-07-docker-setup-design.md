# Docker Setup

## Overview

Containerize the app with Docker and docker-compose for standalone deployment. Includes git and SSH support for pulling private repos via the webhook endpoint.

## Components

### Dockerfile

- Multi-stage build: deps → build → production
- Base image: `node:20-alpine`
- Production stage installs `git` and `openssh-client` (needed for webhook-triggered `git pull` on private repos)
- Runs Prisma generate during build
- Runs as non-root `node` user
- Entrypoint runs Prisma migrations then starts the Next.js production server

### docker-compose.yml

Single service `app`:

| Config | Value |
|---|---|
| Build | `.` (Dockerfile in project root) |
| Ports | `3000:3000` |
| Env file | `.env` |
| Volumes | `./data:/app/data` (SQLite persistence), `~/.ssh:/home/node/.ssh:ro` (SSH key) |
| Restart | `unless-stopped` |

### .dockerignore

Standard Node.js ignores: `node_modules`, `.next`, `.git`, `*.db`, `.env`

### DATABASE_URL

In Docker, SQLite path points to the mounted volume: `file:/app/data/prod.db`

## Out of scope

- No health checks, nginx, or SSL termination
- No auto-clone of the repo on startup — user clones manually inside the container
- No CI/CD pipeline
