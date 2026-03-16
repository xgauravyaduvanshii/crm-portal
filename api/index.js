const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// Load env in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// HELPERS: Parse and manage purchase codes from env
// ============================================================

/**
 * Parse PURCHASE_CODES env variable
 * Format: code:domain:product:license_type,code2:domain2:product2:license_type2
 * domain can be '*' to allow any domain
 */
function parsePurchaseCodes() {
  const raw = process.env.PURCHASE_CODES || '';
  if (!raw.trim()) return [];

  return raw.split(',').map(entry => {
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
  }).filter(Boolean);
}

/**
 * Save purchase codes back to process.env (runtime only)
 * For Vercel, codes must be managed via Vercel env vars or dashboard
 */
function savePurchaseCodes(codes) {
  const raw = codes.map(c =>
    `${c.purchase_code}:${c.domain}:${c.product}:${c.license_type}`
  ).join(',');
  process.env.PURCHASE_CODES = raw;
}

// In-memory store that loads from env on startup
let purchaseCodesStore = parsePurchaseCodes();

// Verification log (in-memory, resets on restart)
let verificationLog = [];

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

function requireAdminKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    return res.status(500).json({ error: 'Admin API key not configured on server' });
  }

  if (apiKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized. Invalid API key.' });
  }

  next();
}

// ============================================================
// API ROUTES
// ============================================================

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    total_licenses: purchaseCodesStore.length
  });
});

/**
 * POST /api/verify
 * Verify a purchase code (called by Laravel app)
 * Body: { purchase_code: string, domain?: string, product?: string }
 */
app.post('/api/verify', (req, res) => {
  const { purchase_code, domain, product } = req.body;

  if (!purchase_code) {
    return res.json({
      valid: false,
      error: 'invalid_code',
      message: 'Purchase code is required.'
    });
  }

  // Reload from env in case it was updated
  purchaseCodesStore = parsePurchaseCodes();

  // Find the purchase code
  const license = purchaseCodesStore.find(
    c => c.purchase_code === purchase_code
  );

  // Log the verification attempt
  const logEntry = {
    id: uuidv4(),
    purchase_code: purchase_code.substring(0, 8) + '****',
    domain: domain || 'unknown',
    product: product || 'rocketlms',
    timestamp: new Date().toISOString(),
    result: 'pending'
  };

  if (!license) {
    logEntry.result = 'not_found';
    verificationLog.unshift(logEntry);
    if (verificationLog.length > 100) verificationLog = verificationLog.slice(0, 100);

    return res.json({
      valid: false,
      error: 'no_code',
      message: 'This purchase code is not registered. Please submit your license in the CRM portal first.'
    });
  }

  // Check domain if specified and not wildcard
  if (domain && license.domain !== '*' && license.domain !== domain) {
    logEntry.result = 'domain_mismatch';
    verificationLog.unshift(logEntry);
    if (verificationLog.length > 100) verificationLog = verificationLog.slice(0, 100);

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
    verificationLog.unshift(logEntry);
    if (verificationLog.length > 100) verificationLog = verificationLog.slice(0, 100);

    return res.json({
      valid: false,
      error: 'product_mismatch',
      message: 'This purchase code is for a different product.'
    });
  }

  // Valid!
  logEntry.result = 'valid';
  verificationLog.unshift(logEntry);
  if (verificationLog.length > 100) verificationLog = verificationLog.slice(0, 100);

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
app.get('/api/licenses', requireAdminKey, (req, res) => {
  purchaseCodesStore = parsePurchaseCodes();
  res.json({
    success: true,
    licenses: purchaseCodesStore.map(c => ({
      ...c,
      purchase_code_masked: c.purchase_code.substring(0, 8) + '...' + c.purchase_code.substring(c.purchase_code.length - 4)
    })),
    total: purchaseCodesStore.length
  });
});

/**
 * POST /api/licenses
 * Add a new purchase code (admin only)
 * Body: { purchase_code, domain, product, license_type }
 */
app.post('/api/licenses', requireAdminKey, (req, res) => {
  const { purchase_code, domain, product, license_type } = req.body;

  if (!purchase_code) {
    return res.status(400).json({ error: 'purchase_code is required' });
  }

  if (purchase_code.length !== 36) {
    return res.status(400).json({ error: 'purchase_code must be 36 characters (UUID format)' });
  }

  // Reload fresh
  purchaseCodesStore = parsePurchaseCodes();

  // Check for duplicates
  const exists = purchaseCodesStore.find(c => c.purchase_code === purchase_code);
  if (exists) {
    return res.status(409).json({ error: 'This purchase code already exists' });
  }

  const newLicense = {
    purchase_code,
    domain: domain || '*',
    product: product || 'rocketlms',
    license_type: license_type || 'Regular license'
  };

  purchaseCodesStore.push(newLicense);
  savePurchaseCodes(purchaseCodesStore);

  res.status(201).json({
    success: true,
    message: 'Purchase code added successfully',
    license: newLicense,
    env_value: process.env.PURCHASE_CODES
  });
});

/**
 * PUT /api/licenses/:code
 * Update an existing purchase code (admin only)
 */
app.put('/api/licenses/:code', requireAdminKey, (req, res) => {
  const { code } = req.params;
  const { domain, product, license_type } = req.body;

  purchaseCodesStore = parsePurchaseCodes();

  const index = purchaseCodesStore.findIndex(c => c.purchase_code === code);
  if (index === -1) {
    return res.status(404).json({ error: 'Purchase code not found' });
  }

  if (domain !== undefined) purchaseCodesStore[index].domain = domain;
  if (product !== undefined) purchaseCodesStore[index].product = product;
  if (license_type !== undefined) purchaseCodesStore[index].license_type = license_type;

  savePurchaseCodes(purchaseCodesStore);

  res.json({
    success: true,
    message: 'Purchase code updated successfully',
    license: purchaseCodesStore[index],
    env_value: process.env.PURCHASE_CODES
  });
});

/**
 * DELETE /api/licenses/:code
 * Delete a purchase code (admin only)
 */
app.delete('/api/licenses/:code', requireAdminKey, (req, res) => {
  const { code } = req.params;

  purchaseCodesStore = parsePurchaseCodes();

  const index = purchaseCodesStore.findIndex(c => c.purchase_code === code);
  if (index === -1) {
    return res.status(404).json({ error: 'Purchase code not found' });
  }

  purchaseCodesStore.splice(index, 1);
  savePurchaseCodes(purchaseCodesStore);

  res.json({
    success: true,
    message: 'Purchase code deleted successfully',
    env_value: process.env.PURCHASE_CODES
  });
});

/**
 * GET /api/logs
 * Get verification logs (admin only)
 */
app.get('/api/logs', requireAdminKey, (req, res) => {
  res.json({
    success: true,
    logs: verificationLog,
    total: verificationLog.length
  });
});

// ============================================================
// START SERVER (local development)
// ============================================================

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`🚀 CRM Portal API running on http://localhost:${PORT}`);
    console.log(`📋 Admin Dashboard: http://localhost:${PORT}/index.html`);
    console.log(`📊 Loaded ${purchaseCodesStore.length} purchase codes from env`);
  });
}

// Export for Vercel serverless
module.exports = app;
