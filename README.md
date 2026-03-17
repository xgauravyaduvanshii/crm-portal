# CRM Portal (License CRM Portal)

**About**  
Modern CRM portal to verify and manage software purchase codes with a simple admin dashboard.

**Description**  
This project is a Node.js/Express-based CRM portal that validates purchase codes, enforces domain/product rules, and exposes an admin interface to manage licenses and view verification logs. It ships with a static dashboard UI and a REST API, and is ready to deploy on Vercel.

## Features
- Purchase code verification via REST API
- Admin-only license management (add/update/delete)
- Verification logs with masked codes
- Persistent license storage via Vercel KV (Upstash Redis)
- Rate limiting for `/api/verify`
- Static admin dashboard UI
- Vercel-ready serverless deployment

## Tech Stack
- Node.js + Express
- CORS + dotenv
- Vercel KV (Upstash Redis)
- Vercel serverless functions + static hosting

## API Endpoints
- `GET /api/health` Health check
- `POST /api/verify` Verify a purchase code
- `GET /api/licenses` List licenses (admin only)
- `POST /api/licenses` Add license (admin only)
- `PUT /api/licenses/:code` Update license (admin only)
- `DELETE /api/licenses/:code` Delete license (admin only)
- `GET /api/logs` Verification logs (admin only)

Admin requests require the API key in the `x-api-key` header or `api_key` query parameter.

## Environment Variables
Use `.env` for local development and `.env.example` as a template.

- `KV_REST_API_URL` Vercel KV REST API URL (required in production)
- `KV_REST_API_TOKEN` Vercel KV REST API token (required in production)
- `KV_REST_API_READ_ONLY_TOKEN` Optional read-only token for KV
- `PURCHASE_CODES` Optional seed list in the format `code:domain:product:license_type` (used only if KV is empty)
- `ADMIN_API_KEY` API key required for admin endpoints
- `ALLOWED_ORIGINS` Comma-separated CORS allowlist (leave empty to allow all)
- `VERIFY_RATE_LIMIT_MAX` Max requests per window for `/api/verify` (default: `60`)
- `VERIFY_RATE_LIMIT_WINDOW_SEC` Rate limit window in seconds (default: `60`)
- `PORT` Local server port (default: `3000`)

## Local Development
1. `npm install`
2. Copy `.env.example` to `.env` and update values
3. `npm run dev`
4. Open `http://localhost:3000`

## Deployment (Vercel)
This repo includes `vercel.json` for serverless + static routing. Attach a Vercel KV / Redis integration so the KV env vars are injected, then set `ADMIN_API_KEY`, `ALLOWED_ORIGINS`, and any rate-limit values.

## Author
- **Name:** xgauravyaduvanshii
- **Email:** xgauravyaduvanshii@gmail.com
- **GitHub:** https://github.com/xgauravyaduvanshii

## Repository
https://github.com/xgauravyaduvanshii/crm-portal
