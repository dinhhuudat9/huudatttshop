# Deployment

This repository now supports these 3 deployment targets:

- Render: full Node.js app (frontend + API) in one service.
- Vercel: static frontend + serverless API using `vercel.json`.
- Cloudflare Workers: static frontend from `./frontend` + same-origin proxy for `/api` and `/frames`.
- Netlify: static frontend from the repo root plus a Netlify Function for `/api`.

## Shared backend environment variables

Set these on Render or Vercel:

```env
NODE_ENV=production
TRUST_PROXY=1
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
JWT_SECRET=
ASSET_SESSION_SECRET=
ADMIN_EMAIL=
ADMIN_PASSWORD=
CORS_ORIGINS=
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

Notes:

- `CORS_ORIGINS` is optional for Vercel/Render same-origin deploys.
- If Cloudflare uses a custom domain and proxies to Render/Vercel, add that domain to `CORS_ORIGINS`.
- `*.workers.dev` is already allowed by the backend.

## Netlify

Files used:

- `netlify.toml`
- `netlify/functions/api.js`

Deploy steps:

1. Import the repo into Netlify.
2. Set the same backend environment variables listed above.
3. Deploy.
4. Verify the site root and `GET /api/health`.

Notes:

- Frontend assets are served from the repository root through Netlify redirects.
- `/api/*` is handled by `netlify/functions/api.js`.
- The backend bootstrap runs without starting the Telegram bot in the function runtime.

## Render

Files used:

- `render.yaml`
- `backend/server.js`

Deploy steps:

1. Create a new Render Web Service from this repo.
2. Let Render detect `render.yaml`.
3. Fill in the required environment variables.
4. Deploy and verify `GET /api/health`.

## Vercel

Files used:

- `vercel.json`
- `api/index.js`
- `api/[...path].js`

Deploy steps:

1. Import the repo into Vercel.
2. Add the same backend environment variables listed above.
3. Deploy.
4. Verify the site root and `GET /api/health`.

## Cloudflare Workers

Files used:

- `wrangler.toml`
- `frontend/worker.js`

Worker behavior:

- Serves the SPA directly from `./frontend`.
- Proxies `/api/*` and `/frames/*` to `BACKEND_ORIGIN`.

Set this variable in `wrangler.toml` or as a Cloudflare Worker variable:

```env
BACKEND_ORIGIN=https://your-render-or-vercel-domain.example.com
```

Recommended flow:

1. Deploy the backend first on Render or Vercel.
2. Put that backend URL into `BACKEND_ORIGIN`.
3. Deploy the Worker with `wrangler deploy`.
4. If using a custom Cloudflare domain, add that domain to backend `CORS_ORIGINS`.

## Request reduction changes included

- GET request dedupe in `frontend/js/api.js`
- short-lived cache for `settings`, `categories`, `auth/me`, and `notifications/important`
- protected asset cache for HTML/CSS in `frontend/js/asset-loader.js`
- route scripts no longer use a timestamp cache-buster on every navigation
- Cloudflare Worker no longer performs duplicate captcha verification before proxying POST requests
