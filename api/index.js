const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { kv } = require('@vercel/kv');

// Load env in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// ============================================================
// CONFIG
// ============================================================

const LICENSES_KEY = 'licenses';
const LOGS_KEY = 'verification_logs';
const LOG_LIMIT = 100;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.length === 0) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('CORS_NOT_ALLOWED'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  maxAge: 600
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Handle CORS errors cleanly
app.use((err, req, res, next) => {
  if (err && err.message === 'CORS_NOT_ALLOWED') {
    return res.status(403).json({ error: 'CORS not allowed' });
  }
  return next(err);
});

// ============================================================
// HELPERS: Parse and seed purchase codes from env (optional)
// ============================================================

/**
 * Parse PURCHASE_CODES env variable
 * Format: code:domain:product:license_type,code2:domain2:product2:license_type2
 * domain can be '*' to allow any domain
 */
function parsePurchaseCodes() {
  const raw = process.env.PURCHASE_CODES || '';
  if (!raw.trim()) return [];

  return raw
    .split(',')
    .map(entry => {
      const parts = entry.trim().split(':');
      if (parts.length >= 4) {
        return {
          purchase_code: parts[0],
          domain: parts[1],
          product: parts[2],
          license_type: parts.slice(3).join(':') // license_type may contain colons
        };
      }
      return null;
    })
    .filter(Boolean);
}

let seeded = false;

async function ensureSeeded() {
  if (seeded) return;

  const count = await kv.hlen(LICENSES_KEY);
  if (count === 0) {
    const envCodes = parsePurchaseCodes();
    if (envCodes.length > 0) {
      const payload = {};
      for (const license of envCodes) {
        payload[license.purchase_code] = JSON.stringify(license);
      }
      await kv.hset(LICENSES_KEY, payload);
    }
  }

  seeded = true;
}

function parseStoredLicense(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

async function getLicense(code) {
  await ensureSeeded();
  const raw = await kv.hget(LICENSES_KEY, code);
  return parseStoredLicense(raw);
}

async function listLicenses() {
  await ensureSeeded();
  const data = await kv.hgetall(LICENSES_KEY);
  if (!data) return [];
  return Object.values(data)
    .map(parseStoredLicense)
    .filter(Boolean);
}

async function saveLicense(license) {
  await kv.hset(LICENSES_KEY, {
    [license.purchase_code]: JSON.stringify(license)
  });
}

async function deleteLicense(code) {
  await kv.hdel(LICENSES_KEY, code);
}

async function addLog(entry) {
  await kv.lpush(LOGS_KEY, JSON.stringify(entry));
  await kv.ltrim(LOGS_KEY, 0, LOG_LIMIT - 1);
}

async function getLogs() {
  const raw = await kv.lrange(LOGS_KEY, 0, LOG_LIMIT - 1);
  if (!raw) return [];
  return raw.map(parseStoredLicense).filter(Boolean);
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function requireAdminKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key || '';
  const adminKey = process.env.ADMIN_API_KEY || '';

  if (!adminKey) {
    return res.status(500).json({ error: 'Admin API key not configured on server' });
  }

  if (!safeEqual(String(apiKey), adminKey)) {
    return res.status(401).json({ error: 'Unauthorized. Invalid API key.' });
  }

  return next();
}

async function rateLimitVerify(req, res, next) {
  const max = Number.parseInt(process.env.VERIFY_RATE_LIMIT_MAX || '60', 10);
  const windowSec = Number.parseInt(process.env.VERIFY_RATE_LIMIT_WINDOW_SEC || '60', 10);

  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(windowSec) || windowSec <= 0) {
    return next();
  }

  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = (rawIp || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const key = `rl:verify:${ip}`;

  try {
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expire(key, windowSec);
    }
    if (count > max) {
      return res.status(429).json({
        valid: false,
        error: 'rate_limited',
        message: 'Too many requests. Please try again later.'
      });
    }
    return next();
  } catch (err) {
    console.error('Rate limit error', err);
    return res.status(500).json({
      valid: false,
      error: 'server_error',
      message: 'Server error occurred while validating the license. Please try again later or contact support.'
    });
  }
}

// ============================================================
// API ROUTES
// ============================================================

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', async (req, res) => {
  try {
    await ensureSeeded();
    const total = await kv.hlen(LICENSES_KEY);
    return res.json({
      status: 'ok',
      storage: 'kv',
      timestamp: new Date().toISOString(),
      total_licenses: total
    });
  } catch (err) {
    console.error('KV health error', err);
    return res.status(500).json({
      status: 'error',
      storage: 'kv',
      timestamp: new Date().toISOString(),
      message: 'KV storage unavailable'
    });
  }
});

/**
 * POST /api/verify
 * Verify a purchase code (called by Laravel app)
 * Body: { purchase_code: string, domain?: string, product?: string }
 */
app.post('/api/verify', rateLimitVerify, async (req, res) => {
  const { purchase_code, domain, product } = req.body || {};

  if (!purchase_code) {
    return res.json({
      valid: false,
      error: 'invalid_code',
      message: 'Purchase code is required.'
    });
  }

  let license;
  try {
    license = await getLicense(purchase_code);
  } catch (err) {
    console.error('KV verify error', err);
    return res.status(500).json({
      valid: false,
      error: 'server_error',
      message: 'Server error occurred while validating the license. Please try again later or contact support.'
    });
  }

  const logEntry = {
    id: uuidv4(),
    purchase_code: purchase_code.substring(0, 8) + '****',
    domain: domain || 'unknown',
    product: product || 'lostry',
    timestamp: new Date().toISOString(),
    result: 'pending'
  };

  if (!license) {
    logEntry.result = 'not_found';
    try {
      await addLog(logEntry);
    } catch (err) {
      console.error('Log write error', err);
    }

    return res.json({
      valid: false,
      error: 'no_code',
      message: 'This purchase code is not registered. Please submit your license in the CRM portal first.'
    });
  }

  // Check domain if specified and not wildcard
  if (domain && license.domain !== '*' && license.domain !== domain) {
    logEntry.result = 'domain_mismatch';
    try {
      await addLog(logEntry);
    } catch (err) {
      console.error('Log write error', err);
    }

    return res.json({
      valid: false,
      error: 'domain_mismatch',
      message: `This purchase code is registered for ${license.domain}.`,
      registered_domain: license.domain
    });
  }

  // Check product type if specified
  if (product && license.product !== product && license.product !== '*') {
    logEntry.result = 'product_mismatch';
    try {
      await addLog(logEntry);
    } catch (err) {
      console.error('Log write error', err);
    }

    return res.json({
      valid: false,
      error: 'product_mismatch',
      message: 'This purchase code is for a different product.'
    });
  }

  // Valid!
  logEntry.result = 'valid';
  try {
    await addLog(logEntry);
  } catch (err) {
    console.error('Log write error', err);
  }

  return res.json({
    valid: true,
    license_type: license.license_type || 'Regular license',
    product: license.product,
    message: 'License verified successfully.'
  });
});

/**
 * GET /api/licenses
 * List all purchase codes (admin only)
 */
app.get('/api/licenses', requireAdminKey, async (req, res) => {
  try {
    const licenses = await listLicenses();
    return res.json({
      success: true,
      licenses: licenses.map(c => ({
        ...c,
        purchase_code_masked: c.purchase_code.substring(0, 8) + '...' + c.purchase_code.substring(c.purchase_code.length - 4)
      })),
      total: licenses.length
    });
  } catch (err) {
    console.error('KV list error', err);
    return res.status(500).json({ error: 'Server error while listing licenses' });
  }
});

/**
 * POST /api/licenses
 * Add a new purchase code (admin only)
 * Body: { purchase_code, domain, product, license_type }
 */
app.post('/api/licenses', requireAdminKey, async (req, res) => {
  const { purchase_code, domain, product, license_type } = req.body || {};

  if (!purchase_code) {
    return res.status(400).json({ error: 'purchase_code is required' });
  }

  if (purchase_code.length !== 36) {
    return res.status(400).json({ error: 'purchase_code must be 36 characters (UUID format)' });
  }

  try {
    const exists = await getLicense(purchase_code);
    if (exists) {
      return res.status(409).json({ error: 'This purchase code already exists' });
    }

    const newLicense = {
      purchase_code,
      domain: domain || '*',
      product: product || 'lostry',
      license_type: license_type || 'Regular license'
    };

    await saveLicense(newLicense);

    return res.status(201).json({
      success: true,
      message: 'Purchase code added successfully',
      license: newLicense
    });
  } catch (err) {
    console.error('KV add error', err);
    return res.status(500).json({ error: 'Server error while adding license' });
  }
});

/**
 * PUT /api/licenses/:code
 * Update an existing purchase code (admin only)
 */
app.put('/api/licenses/:code', requireAdminKey, async (req, res) => {
  const { code } = req.params;
  const { domain, product, license_type } = req.body || {};

  try {
    const existing = await getLicense(code);
    if (!existing) {
      return res.status(404).json({ error: 'Purchase code not found' });
    }

    const updated = {
      ...existing,
      domain: domain !== undefined ? domain : existing.domain,
      product: product !== undefined ? product : existing.product,
      license_type: license_type !== undefined ? license_type : existing.license_type
    };

    await saveLicense(updated);

    return res.json({
      success: true,
      message: 'Purchase code updated successfully',
      license: updated
    });
  } catch (err) {
    console.error('KV update error', err);
    return res.status(500).json({ error: 'Server error while updating license' });
  }
});

/**
 * DELETE /api/licenses/:code
 * Delete a purchase code (admin only)
 */
app.delete('/api/licenses/:code', requireAdminKey, async (req, res) => {
  const { code } = req.params;

  try {
    const existing = await getLicense(code);
    if (!existing) {
      return res.status(404).json({ error: 'Purchase code not found' });
    }

    await deleteLicense(code);

    return res.json({
      success: true,
      message: 'Purchase code deleted successfully'
    });
  } catch (err) {
    console.error('KV delete error', err);
    return res.status(500).json({ error: 'Server error while deleting license' });
  }
});

/**
 * GET /api/logs
 * Get verification logs (admin only)
 */
app.get('/api/logs', requireAdminKey, async (req, res) => {
  try {
    const logs = await getLogs();
    return res.json({
      success: true,
      logs,
      total: logs.length
    });
  } catch (err) {
    console.error('KV logs error', err);
    return res.status(500).json({ error: 'Server error while fetching logs' });
  }
});

// ============================================================
// START SERVER (local development)
// ============================================================

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 CRM Portal API running on http://localhost:${PORT}`);
    console.log(`📋 Admin Dashboard: http://localhost:${PORT}/index.html`);
  });
}

// Export for Vercel serverless
module.exports = app;
