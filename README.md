# CRM Portal (License CRM Portal)

**About**  
Modern CRM portal to verify and manage software purchase codes with a simple admin dashboard.

**Description**  
This project is a Node.js/Express-based CRM portal that validates purchase codes, enforces domain/product rules, and exposes an admin interface to manage licenses and view verification logs. It ships with a static dashboard UI and a REST API, and is ready to deploy on Vercel.

## Features
- Purchase code verification via REST API
- Admin-only license management (add/update/delete)
- Verification logs with masked codes
- Static admin dashboard UI
- Vercel-ready serverless deployment

## Tech Stack
- Node.js + Express
- CORS + dotenv
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

- `PURCHASE_CODES` Comma-separated list in the format `code:domain:product:license_type`
- `ADMIN_API_KEY` API key required for admin endpoints
- `PORT` Local server port (default: `3000`)

## Local Development
1. `npm install`
2. Copy `.env.example` to `.env` and update values
3. `npm run dev`
4. Open `http://localhost:3000`

## Deployment (Vercel)
This repo includes `vercel.json` for serverless + static routing. Configure `PURCHASE_CODES` and `ADMIN_API_KEY` in Vercel environment variables.

## Author
- **Name:** xgauravyaduvanshii
- **Email:** xgauravyaduvanshii@gmail.com
- **GitHub:** https://github.com/xgauravyaduvanshii

## Repository
https://github.com/xgauravyaduvanshii/crm-portal
