'use strict';

/**
 * Microsoft Entra ID OIDC Authentication Module.
 * Implements Authorization Code flow with PKCE for single-tenant SSO.
 * @module lib/auth
 */

const crypto = require('crypto');
const config = require('./config');

/**
 * OIDC client instance (lazy-loaded)
 * @type {import('openid-client').Client|null}
 */
let oidcClient = null;

/**
 * OIDC issuer instance (lazy-loaded)
 * @type {import('openid-client').Issuer|null}
 */
let oidcIssuer = null;

/**
 * Initialize the OIDC client using openid-client library.
 * @returns {Promise<import('openid-client').Client>}
 */
async function getOidcClient() {
  if (oidcClient) {
    return oidcClient;
  }

  const { Issuer } = require('openid-client');

  const { tenantId, clientId, clientSecret } = config.entra;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Entra OIDC not configured. Set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, and ENTRA_CLIENT_SECRET.'
    );
  }

  // Microsoft Entra ID OpenID Connect discovery endpoint
  const issuerUrl = `https://login.microsoftonline.com/${tenantId}/v2.0`;

  oidcIssuer = await Issuer.discover(issuerUrl);
  console.log('[AUTH] Discovered issuer:', oidcIssuer.metadata.issuer);

  oidcClient = new oidcIssuer.Client({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: [`${config.baseUrl}${config.entra.redirectPath}`],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });

  return oidcClient;
}

/**
 * Generate a cryptographically secure random string for state/nonce.
 * @param {number} length
 * @returns {string}
 */
function generateSecureRandom(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Validate that a return URL is safe (same-origin only).
 * Prevents open redirect vulnerabilities.
 * @param {string} returnTo
 * @param {string} baseUrl
 * @returns {string} Safe return URL or default '/'
 */
function validateReturnTo(returnTo, baseUrl) {
  if (!returnTo || typeof returnTo !== 'string') {
    return '/';
  }

  // Remove leading/trailing whitespace
  const trimmed = returnTo.trim();

  // Allow relative paths starting with /
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    // Prevent protocol-relative URLs and path traversal
    const normalized = trimmed.replace(/\/+/g, '/');
    if (!normalized.includes('..') && !normalized.includes('\\')) {
      return normalized;
    }
  }

  // Allow same-origin absolute URLs
  try {
    const url = new URL(trimmed);
    const base = new URL(baseUrl);
    if (url.origin === base.origin) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    // Invalid URL, fall through to default
  }

  return '/';
}

/**
 * Build the authorization URL for Entra login.
 * Stores state, nonce, and codeVerifier in session for validation.
 * @param {Object} session - Express session object
 * @param {string} [returnTo] - URL to return to after login
 * @returns {Promise<string>} Authorization URL
 */
async function buildAuthorizationUrl(session, returnTo) {
  const client = await getOidcClient();
  const { generators } = require('openid-client');

  const state = generateSecureRandom();
  const nonce = generateSecureRandom();
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);

  // Store OIDC transaction data in session
  session.oidcTransaction = {
    state,
    nonce,
    codeVerifier,
    returnTo: validateReturnTo(returnTo, config.baseUrl),
    createdAt: Date.now(),
  };

  const authUrl = client.authorizationUrl({
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return authUrl;
}

/**
 * Handle the OIDC callback and validate tokens.
 * @param {Object} session - Express session object
 * @param {Object} query - Query parameters from callback
 * @returns {Promise<Object>} Token set and user claims
 */
async function handleCallback(session, query) {
  const client = await getOidcClient();
  const { oidcTransaction } = session;

  if (!oidcTransaction) {
    throw new Error('No OIDC transaction found in session. Please try logging in again.');
  }

  // Check transaction expiry (5 minutes)
  const TRANSACTION_TTL = 5 * 60 * 1000;
  if (Date.now() - oidcTransaction.createdAt > TRANSACTION_TTL) {
    delete session.oidcTransaction;
    throw new Error('Login session expired. Please try again.');
  }

  const { state, nonce, codeVerifier, returnTo } = oidcTransaction;

  // Validate state
  if (query.state !== state) {
    delete session.oidcTransaction;
    throw new Error('Invalid state parameter. Possible CSRF attack.');
  }

  // Exchange code for tokens
  const params = client.callbackParams({ query });
  const redirectUri = `${config.baseUrl}${config.entra.redirectPath}`;

  const tokenSet = await client.callback(redirectUri, params, {
    code_verifier: codeVerifier,
    state,
    nonce,
  });

  // Validate ID token claims
  const claims = tokenSet.claims();

  if (claims.nonce !== nonce) {
    throw new Error('Invalid nonce in ID token.');
  }

  // Clean up transaction
  delete session.oidcTransaction;

  return { tokenSet, claims, returnTo };
}

/**
 * Check if user is in the allowed group.
 * First checks token claims, then falls back to error if not present.
 * @param {Object} claims - Token claims
 * @param {import('openid-client').TokenSet} tokenSet - Token set for Graph API fallback
 * @returns {Promise<boolean>}
 */
async function checkGroupMembership(claims, tokenSet) {
  const { allowedGroupId } = config.entra;

  if (!allowedGroupId) {
    console.warn('[AUTH] No ENTRA_ALLOWED_GROUP_ID configured. Allowing all authenticated users.');
    return true;
  }

  // Check if groups claim is present in token
  if (claims.groups && Array.isArray(claims.groups)) {
    const isMember = claims.groups.includes(allowedGroupId);
    console.log(`[AUTH] Group check via token claim: ${isMember ? 'authorized' : 'denied'}`);
    return isMember;
  }

  // Check for group overage indicator
  if (claims._claim_names && claims._claim_names.groups) {
    console.warn(
      '[AUTH] Group overage detected. Token contains too many groups. ' +
        'Configure the Entra app to emit group claims for the specific group, or reduce user group count. ' +
        'See docs/auth.md for configuration steps.'
    );
    throw new Error(
      'Group membership could not be verified. Your account has too many group memberships. ' +
        'Please contact your administrator.'
    );
  }

  // Groups not in token - provide actionable error
  console.warn(
    '[AUTH] No groups claim in token. Configure the Entra app registration to emit group claims. ' +
      'See docs/auth.md for configuration steps.'
  );
  throw new Error(
    'Group membership could not be verified. The application is not configured to receive group claims. ' +
      'Please contact your administrator.'
  );
}

/**
 * Build the end session (logout) URL.
 * @param {string} [idTokenHint] - ID token for logout
 * @returns {Promise<string>}
 */
async function buildLogoutUrl(idTokenHint) {
  await getOidcClient(); // Ensure issuer is loaded

  const postLogoutRedirectUri = `${config.baseUrl}${config.entra.postLogoutRedirectPath}`;

  // Microsoft Entra logout endpoint
  const logoutUrl = new URL(
    `https://login.microsoftonline.com/${config.entra.tenantId}/oauth2/v2.0/logout`
  );
  logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);

  if (idTokenHint) {
    logoutUrl.searchParams.set('id_token_hint', idTokenHint);
  }

  return logoutUrl.toString();
}

/**
 * Express middleware: Require authentication.
 * Redirects to login if no session user.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  // Store original URL for redirect after login
  const returnTo = req.originalUrl || req.url;

  // For API requests, return 401
  if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Redirect to login
  return res.redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}

/**
 * Express middleware: Require group membership.
 * Must be used after requireAuth.
 */
function requireGroup(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.session.user.authorized !== true) {
    console.log(`[AUTH] Access denied for user ${req.session.user.email}: not in allowed group`);
    return res.status(403).render ? res.status(403).send(
      '<!DOCTYPE html><html><head><title>Access Denied</title>' +
      '<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f7fb;}' +
      '.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.08);text-align:center;max-width:400px;}' +
      'h1{color:#e74266;margin-bottom:1rem;}a{color:#e74266;}</style></head>' +
      '<body><div class="card"><h1>Access Denied</h1>' +
      '<p>You are not authorized to access this application. Please contact your administrator to request access.</p>' +
      '<p style="margin-top:1rem;"><a href="/auth/logout">Sign out</a></p></div></body></html>'
    ) : res.status(403).json({ error: 'Access denied. Not in allowed group.' });
  }

  return next();
}

/**
 * Create auth router with OIDC routes.
 * @param {import('express').Express} app
 */
function createAuthRoutes(app) {
  const express = require('express');
  const router = express.Router();

  // Login route - redirects to Entra
  router.get('/login', async (req, res, next) => {
    try {
      const returnTo = req.query.returnTo || '/chat.html';
      const authUrl = await buildAuthorizationUrl(req.session, returnTo);
      res.redirect(authUrl);
    } catch (err) {
      console.error('[AUTH] Login error:', err);
      next(err);
    }
  });

  // Callback route - handles OIDC response
  router.get('/callback', async (req, res, next) => {
    try {
      // Check for error response from Entra
      if (req.query.error) {
        console.error('[AUTH] Entra error:', req.query.error, req.query.error_description);
        throw new Error(req.query.error_description || req.query.error);
      }

      const { tokenSet, claims, returnTo } = await handleCallback(req.session, req.query);

      // Check group membership
      const authorized = await checkGroupMembership(claims, tokenSet);

      // Store user in session
      req.session.user = {
        sub: claims.sub,
        email: claims.email || claims.preferred_username || claims.upn,
        name: claims.name,
        authorized,
        idToken: tokenSet.id_token,
      };

      // Regenerate session ID to prevent session fixation
      req.session.regenerate((err) => {
        if (err) {
          console.error('[AUTH] Session regeneration error:', err);
        }

        // Re-set user data after regeneration
        req.session.user = {
          sub: claims.sub,
          email: claims.email || claims.preferred_username || claims.upn,
          name: claims.name,
          authorized,
          idToken: tokenSet.id_token,
        };

        // Redirect to original destination or default
        const safeReturnTo = validateReturnTo(returnTo, config.baseUrl);
        res.redirect(safeReturnTo);
      });
    } catch (err) {
      console.error('[AUTH] Callback error:', err);

      // Clean error page
      res.status(400).send(
        '<!DOCTYPE html><html><head><title>Login Error</title>' +
        '<style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f7fb;}' +
        '.card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.08);text-align:center;max-width:400px;}' +
        'h1{color:#e74266;margin-bottom:1rem;}a{color:#e74266;}</style></head>' +
        `<body><div class="card"><h1>Login Error</h1><p>${escapeHtml(err.message)}</p>` +
        '<p style="margin-top:1rem;"><a href="/auth/login">Try again</a></p></div></body></html>'
      );
    }
  });

  // Logout route
  router.get('/logout', async (req, res) => {
    try {
      const idToken = req.session?.user?.idToken;

      // Destroy local session
      req.session.destroy(async (err) => {
        if (err) {
          console.error('[AUTH] Session destruction error:', err);
        }

        // Clear session cookie
        res.clearCookie('connect.sid');

        // Redirect to Microsoft logout
        try {
          const logoutUrl = await buildLogoutUrl(idToken);
          res.redirect(logoutUrl);
        } catch (logoutErr) {
          console.error('[AUTH] Logout URL error:', logoutErr);
          // Fallback to local redirect
          res.redirect('/');
        }
      });
    } catch (err) {
      console.error('[AUTH] Logout error:', err);
      res.redirect('/');
    }
  });

  // Session status endpoint (for frontend)
  router.get('/status', (req, res) => {
    if (req.session && req.session.user) {
      res.json({
        authenticated: true,
        user: {
          email: req.session.user.email,
          name: req.session.user.name,
          authorized: req.session.user.authorized,
        },
      });
    } else {
      res.json({ authenticated: false });
    }
  });

  app.use('/auth', router);
}

/**
 * Escape HTML to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  getOidcClient,
  buildAuthorizationUrl,
  handleCallback,
  checkGroupMembership,
  buildLogoutUrl,
  validateReturnTo,
  requireAuth,
  requireGroup,
  createAuthRoutes,
};
