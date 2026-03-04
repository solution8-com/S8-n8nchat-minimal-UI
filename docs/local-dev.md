# Local Development Guide

This document describes how to run the BROEN-LAB Chat application locally using Docker Compose.

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- Node.js 18+ (for running without Docker)
- Microsoft Entra ID app registration (see [auth.md](auth.md))

## Quick Start with Docker Compose

### 1. Clone the Repository

```bash
git clone https://github.com/solution8-com/S8-n8nchat-minimal-UI.git
cd S8-n8nchat-minimal-UI
```

### 2. Create Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Base configuration
PORT=3000
BASE_URL=http://localhost:3000
NODE_ENV=development

# Session (use any random string for local dev)
SESSION_SECRET=local-dev-secret-change-in-production
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax

# Redis (Docker Compose provides this)
REDIS_URL=redis://redis:6379

# Entra OIDC (get these from Azure Portal)
ENTRA_TENANT_ID=your-tenant-id
ENTRA_CLIENT_ID=your-client-id
ENTRA_CLIENT_SECRET=your-client-secret
ENTRA_ALLOWED_GROUP_ID=your-group-object-id
ENTRA_REDIRECT_PATH=/auth/callback
ENTRA_POST_LOGOUT_REDIRECT_PATH=/

# N8N Webhook
N8N_WEBHOOK_URL=https://your-n8n-instance/webhook/...
N8N_USERNAME=your-username
N8N_PASSWORD=your-password

# Legacy login (optional, disabled by default)
ENABLE_LEGACY_PASSWORD_LOGIN=false
JWT_SECRET=local-jwt-secret
```

### 3. Configure Entra Redirect URI

For local development, add this redirect URI to your Entra app registration:

- `http://localhost:3000/auth/callback`

### 4. Start the Application

```bash
docker compose up --build
```

The application will be available at: http://localhost:3000

### 5. Stop the Application

```bash
docker compose down
```

To also remove volumes (Redis data):

```bash
docker compose down -v
```

## Running Without Docker

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Redis

You'll need Redis running locally:

```bash
# Using Docker
docker run -d -p 6379:6379 --name redis redis:7-alpine

# Or install Redis locally (macOS)
brew install redis
brew services start redis
```

### 3. Configure Environment

Create `.env` file as described above, but change:

```bash
REDIS_URL=redis://localhost:6379
```

### 4. Start the Application

```bash
npm run dev
```

## Development Workflow

### Hot Reloading

For automatic restart on file changes, install nodemon:

```bash
npm install -g nodemon
nodemon server.js
```

### Testing Authentication

1. Navigate to http://localhost:3000
2. Click "Sign in with Microsoft"
3. Authenticate with your Entra credentials
4. If authorized, you'll be redirected to the chat page

### Testing Without Entra (Legacy Mode)

To test with username/password authentication:

1. Set in `.env`:
   ```bash
   ENABLE_LEGACY_PASSWORD_LOGIN=true
   ```
2. Restart the application
3. The login form will appear below the SSO button
4. Use the credentials configured in `N8N_USERNAME` and `N8N_PASSWORD`

### Debugging

View application logs:

```bash
# Docker Compose
docker compose logs -f web

# Without Docker
NODE_ENV=development node server.js
```

### Health Checks

Test health endpoints:

```bash
# Liveness
curl http://localhost:3000/healthz

# Readiness (checks Redis)
curl http://localhost:3000/readyz
```

## Common Issues

### "Redis connection refused"

**Cause**: Redis is not running or not accessible.

**Solutions**:
1. Ensure Redis container is running: `docker ps`
2. Check REDIS_URL format: `redis://localhost:6379` (without Docker) or `redis://redis:6379` (with Docker Compose)

### "Entra OIDC not configured"

**Cause**: Missing Entra environment variables.

**Solutions**:
1. Ensure `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` are set
2. Leave them empty to disable OIDC (chat.html will be unprotected)

### "Invalid redirect_uri"

**Cause**: Entra app registration doesn't have localhost redirect URI.

**Solutions**:
1. Add `http://localhost:3000/auth/callback` to your app registration
2. Ensure `BASE_URL=http://localhost:3000` in `.env`

### Cookies not persisting

**Cause**: Secure cookie flag in non-HTTPS environment.

**Solutions**:
1. Ensure `SESSION_COOKIE_SECURE=false` for local development
2. Check `SESSION_COOKIE_SAMESITE=lax`

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Server port |
| `BASE_URL` | Yes (prod) | `http://localhost:3000` | Public URL |
| `NODE_ENV` | No | `development` | Environment mode |
| `SESSION_SECRET` | Yes | - | Session encryption key |
| `SESSION_COOKIE_SECURE` | No | `true` (prod) | HTTPS-only cookies |
| `SESSION_COOKIE_SAMESITE` | No | `lax` | Cookie SameSite policy |
| `REDIS_URL` | Yes (prod) | - | Redis connection string |
| `ENTRA_TENANT_ID` | Yes | - | Entra tenant ID |
| `ENTRA_CLIENT_ID` | Yes | - | App registration client ID |
| `ENTRA_CLIENT_SECRET` | Yes | - | App registration secret |
| `ENTRA_ALLOWED_GROUP_ID` | Yes | - | Authorized group Object ID |
| `ENTRA_REDIRECT_PATH` | No | `/auth/callback` | OAuth callback path |
| `ENTRA_POST_LOGOUT_REDIRECT_PATH` | No | `/` | Post-logout redirect |
| `N8N_WEBHOOK_URL` | Yes | - | N8N webhook endpoint |
| `N8N_WEBHOOK_URL_TEST` | No | - | N8N test webhook |
| `N8N_USERNAME` | Yes | - | N8N basic auth username |
| `N8N_PASSWORD` | Yes | - | N8N basic auth password |
| `ENABLE_LEGACY_PASSWORD_LOGIN` | No | `false` | Enable username/password auth |
| `JWT_SECRET` | No | - | JWT signing key (legacy mode) |
