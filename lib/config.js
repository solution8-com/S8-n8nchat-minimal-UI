'use strict';

/**
 * Centralized configuration module.
 * Loads environment variables, validates required ones, and exports typed config.
 * Startup fails fast with clear error messages if required config is missing.
 * @module lib/config
 */

/**
 * @typedef {Object} Config
 * @property {number} port
 * @property {string} baseUrl
 * @property {string} nodeEnv
 * @property {boolean} isProduction
 * @property {Object} session
 * @property {string} session.secret
 * @property {boolean} session.cookieSecure
 * @property {'lax'|'strict'|'none'} session.cookieSameSite
 * @property {string} [session.redisUrl]
 * @property {Object} entra
 * @property {string} entra.tenantId
 * @property {string} entra.clientId
 * @property {string} entra.clientSecret
 * @property {string} entra.redirectPath
 * @property {string} entra.postLogoutRedirectPath
 * @property {string} entra.allowedGroupId
 * @property {Object} n8n
 * @property {string} [n8n.webhookUrl]
 * @property {string} [n8n.webhookUrlTest]
 * @property {string} [n8n.username]
 * @property {string} [n8n.password]
 * @property {Object} legacy
 * @property {boolean} legacy.enablePasswordLogin
 * @property {string} [legacy.jwtSecret]
 */

const requiredInProduction = [
  'SESSION_SECRET',
  'REDIS_URL',
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
  'ENTRA_CLIENT_SECRET',
  'ENTRA_ALLOWED_GROUP_ID',
  'BASE_URL',
];

const requiredAlways = [];

/**
 * Validates environment variables and returns config object.
 * @returns {Config}
 */
function loadConfig() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  // Collect missing required vars
  const missing = [];

  for (const key of requiredAlways) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (isProduction) {
    for (const key of requiredInProduction) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
  }

  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(', ')}`;
    console.error(`[CONFIG ERROR] ${message}`);
    if (isProduction) {
      throw new Error(message);
    } else {
      console.warn('[CONFIG WARNING] Running in development mode with missing config. Some features may not work.');
    }
  }

  // Parse boolean/string values
  const parseBool = (value, defaultValue) => {
    if (value === undefined || value === '') return defaultValue;
    return value === 'true' || value === '1';
  };

  const parseSameSite = (value) => {
    const valid = ['lax', 'strict', 'none'];
    const lower = (value || 'lax').toLowerCase();
    return valid.includes(lower) ? lower : 'lax';
  };

  /** @type {Config} */
  const config = {
    port: parseInt(process.env.PORT, 10) || 3000,
    baseUrl: process.env.BASE_URL || `http://localhost:${parseInt(process.env.PORT, 10) || 3000}`,
    nodeEnv,
    isProduction,

    session: {
      secret: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
      cookieSecure: parseBool(process.env.SESSION_COOKIE_SECURE, isProduction),
      cookieSameSite: parseSameSite(process.env.SESSION_COOKIE_SAMESITE),
      redisUrl: process.env.REDIS_URL || null,
    },

    entra: {
      tenantId: process.env.ENTRA_TENANT_ID || '',
      clientId: process.env.ENTRA_CLIENT_ID || '',
      clientSecret: process.env.ENTRA_CLIENT_SECRET || '',
      redirectPath: process.env.ENTRA_REDIRECT_PATH || '/auth/callback',
      postLogoutRedirectPath: process.env.ENTRA_POST_LOGOUT_REDIRECT_PATH || '/',
      allowedGroupId: process.env.ENTRA_ALLOWED_GROUP_ID || '',
    },

    n8n: {
      webhookUrl: process.env.N8N_WEBHOOK_URL || '',
      webhookUrlTest: process.env.N8N_WEBHOOK_URL_TEST || '',
      username: process.env.N8N_USERNAME || '',
      password: process.env.N8N_PASSWORD || '',
    },

    legacy: {
      // Feature flag: explicitly enable legacy password login (disabled by default)
      enablePasswordLogin: parseBool(process.env.ENABLE_LEGACY_PASSWORD_LOGIN, false),
      jwtSecret: process.env.JWT_SECRET || 'change_this_in_prod',
    },
  };

  return config;
}

module.exports = loadConfig();
module.exports.loadConfig = loadConfig;
