'use strict';

require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');

const config = require('./lib/config');
const { createSessionMiddleware, checkRedisHealth, shutdown: shutdownSession } = require('./lib/session');
const { createAuthRoutes, requireAuth, requireGroup } = require('./lib/auth');

const app = express();

// Trust proxy for secure cookies behind load balancer
if (config.isProduction) {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/**
 * Initialize the application with async components.
 */
async function initializeApp() {
  // Initialize session middleware
  const sessionMiddleware = await createSessionMiddleware();
  app.use(sessionMiddleware);

  // Health check endpoints (no auth required)
  app.get('/healthz', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/readyz', async (req, res) => {
    const redisHealthy = await checkRedisHealth();
    if (redisHealthy) {
      res.status(200).json({ status: 'ready', redis: 'connected' });
    } else {
      res.status(503).json({ status: 'not ready', redis: 'disconnected' });
    }
  });

  // Initialize OIDC auth routes
  if (config.entra.tenantId && config.entra.clientId) {
    createAuthRoutes(app);
    console.log('[SERVER] Entra OIDC authentication enabled');
  } else {
    console.warn('[SERVER] Entra OIDC not configured. Auth endpoints disabled.');
  }

  // Legacy password login (disabled by default)
  if (config.legacy.enablePasswordLogin) {
    console.warn('[SERVER] Legacy password login is ENABLED. This should only be used for development/migration.');

    app.post('/login', (req, res) => {
      const { username, password } = req.body || {};
      console.log('Legacy login attempt:', { username, providedPassword: password ? '***' : 'empty' });

      if (username === config.n8n.username && password === config.n8n.password) {
        const token = jwt.sign({ sub: username }, config.legacy.jwtSecret, { expiresIn: '2h' });
        const isSecure = config.isProduction || req.secure || req.headers['x-forwarded-proto'] === 'https';

        res.cookie('session', token, {
          httpOnly: true,
          secure: isSecure,
          sameSite: 'lax',
          maxAge: 2 * 60 * 60 * 1000,
        });
        return res.json({ ok: true });
      }

      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    });

    app.post('/logout', (req, res) => {
      res.clearCookie('session');
      res.json({ ok: true });
    });
  }

  // Static files - serve index.html for root (login page)
  // In OIDC mode, index.html becomes a simple landing/login page
  app.use(express.static(path.join(__dirname), {
    index: false, // Don't auto-serve index.html
  }));

  // Root route - serve login page or redirect to auth
  app.get('/', (req, res) => {
    // If already authenticated, redirect to chat
    if (req.session && req.session.user && req.session.user.authorized) {
      return res.redirect('/chat.html');
    }
    // Serve the landing page with SSO login link
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  // Protected chat page
  if (config.entra.tenantId && config.entra.clientId) {
    app.get('/chat.html', requireAuth, requireGroup, (req, res) => {
      res.sendFile(path.join(__dirname, 'chat.html'));
    });
  } else {
    // Fallback: serve without auth (development)
    app.get('/chat.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'chat.html'));
    });
  }

  // Proxy endpoint - forwards request to real n8n webhook
  // Authentication check supports both OIDC session and legacy JWT
  const authenticateProxy = (req, res, next) => {
    // Check OIDC session
    if (req.session && req.session.user && req.session.user.authorized) {
      return next();
    }

    // Check legacy JWT cookie (if enabled)
    if (config.legacy.enablePasswordLogin) {
      const token = req.cookies.session;
      if (token) {
        try {
          jwt.verify(token, config.legacy.jwtSecret);
          return next();
        } catch {
          // Invalid token, continue to error
        }
      }
    }

    console.log('Proxy request - unauthorized');
    return res.status(401).json({ error: 'Not authenticated' });
  };

  app.all('/proxy/webhook', authenticateProxy, async (req, res) => {
    try {
      if (!config.n8n.webhookUrl) {
        return res.status(500).json({ error: 'N8N webhook URL not configured' });
      }

      const basic = Buffer.from(`${config.n8n.username}:${config.n8n.password}`).toString('base64');

      const upstreamHeaders = {
        'Content-Type': req.get('content-type') || 'application/json',
        Authorization: `Basic ${basic}`,
      };

      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {});

      const upstream = await fetch(config.n8n.webhookUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body,
      });

      const text = await upstream.text();
      res.status(upstream.status);
      upstream.headers.forEach((v, k) => {
        if (!['transfer-encoding', 'content-encoding', 'connection'].includes(k.toLowerCase())) {
          res.setHeader(k, v);
        }
      });
      res.send(text);
    } catch (err) {
      console.error('Proxy error', err);
      res.status(500).json({ error: 'Proxy error' });
    }
  });

  app.all('/proxy/webhook-test', authenticateProxy, async (req, res) => {
    try {
      const target = config.n8n.webhookUrlTest || config.n8n.webhookUrl;
      if (!target) {
        return res.status(500).json({ error: 'N8N webhook URL not configured' });
      }

      const basic = Buffer.from(`${config.n8n.username}:${config.n8n.password}`).toString('base64');

      const upstreamHeaders = {
        'Content-Type': req.get('content-type') || 'application/json',
        Authorization: `Basic ${basic}`,
      };

      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body || {});

      const upstream = await fetch(target, {
        method: req.method,
        headers: upstreamHeaders,
        body,
      });

      const text = await upstream.text();
      res.status(upstream.status);
      upstream.headers.forEach((v, k) => {
        if (!['transfer-encoding', 'content-encoding', 'connection'].includes(k.toLowerCase())) {
          res.setHeader(k, v);
        }
      });
      res.send(text);
    } catch (err) {
      console.error('Proxy error', err);
      res.status(500).json({ error: 'Proxy error' });
    }
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('[SERVER] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Start server
  const server = app.listen(config.port, () => {
    console.log(`[SERVER] Listening on http://localhost:${config.port}`);
    console.log(`[SERVER] Environment: ${config.nodeEnv}`);
    console.log(`[SERVER] Base URL: ${config.baseUrl}`);
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal) => {
    console.log(`[SERVER] Received ${signal}. Shutting down gracefully...`);

    server.close(async () => {
      console.log('[SERVER] HTTP server closed');
      await shutdownSession();
      process.exit(0);
    });

    // Force close after 10 seconds
    setTimeout(() => {
      console.error('[SERVER] Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

// Start the application
initializeApp().catch((err) => {
  console.error('[SERVER] Failed to initialize:', err);
  process.exit(1);
});
