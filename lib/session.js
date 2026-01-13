'use strict';

/**
 * Session configuration module.
 * Configures express-session with Redis store for production.
 * @module lib/session
 */

const session = require('express-session');
const config = require('./config');

/**
 * Redis store instance (lazy-loaded)
 * @type {import('connect-redis').RedisStore|null}
 */
let redisStore = null;

/**
 * Redis client instance for shutdown
 * @type {import('redis').RedisClientType|null}
 */
let redisClient = null;

/**
 * Create session middleware with appropriate store.
 * Uses Redis in production, memory store in development.
 * @returns {Promise<import('express').RequestHandler>}
 */
async function createSessionMiddleware() {
  const sessionConfig = {
    name: 'connect.sid',
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.session.cookieSecure,
      sameSite: config.session.cookieSameSite,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  };

  // Use Redis store if configured
  if (config.session.redisUrl) {
    try {
      const { createClient } = require('redis');
      const RedisStore = require('connect-redis').default;

      redisClient = createClient({
        url: config.session.redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error('[SESSION] Redis max reconnection attempts reached');
              return new Error('Redis max reconnection attempts reached');
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      redisClient.on('error', (err) => {
        console.error('[SESSION] Redis client error:', err);
      });

      redisClient.on('connect', () => {
        console.log('[SESSION] Redis client connected');
      });

      redisClient.on('reconnecting', () => {
        console.log('[SESSION] Redis client reconnecting...');
      });

      await redisClient.connect();

      redisStore = new RedisStore({
        client: redisClient,
        prefix: 'broenlab:sess:',
        ttl: 86400, // 24 hours in seconds
      });

      sessionConfig.store = redisStore;
      console.log('[SESSION] Using Redis session store');
    } catch (err) {
      console.error('[SESSION] Failed to connect to Redis:', err);
      if (config.isProduction) {
        throw new Error('Redis connection required in production. Set REDIS_URL environment variable.');
      }
      console.warn('[SESSION] Falling back to memory store (development only)');
    }
  } else {
    console.log('[SESSION] Using in-memory session store (development only)');
    if (config.isProduction) {
      console.warn('[SESSION] WARNING: Memory store is not suitable for production!');
    }
  }

  return session(sessionConfig);
}

/**
 * Check if Redis connection is healthy.
 * @returns {Promise<boolean>}
 */
async function checkRedisHealth() {
  if (!redisClient) {
    return !config.session.redisUrl; // Healthy if Redis not configured
  }

  try {
    await redisClient.ping();
    return true;
  } catch (err) {
    console.error('[SESSION] Redis health check failed:', err);
    return false;
  }
}

/**
 * Graceful shutdown of session store.
 * @returns {Promise<void>}
 */
async function shutdown() {
  if (redisClient) {
    try {
      await redisClient.quit();
      console.log('[SESSION] Redis client disconnected');
    } catch (err) {
      console.error('[SESSION] Error disconnecting Redis:', err);
    }
  }
}

module.exports = {
  createSessionMiddleware,
  checkRedisHealth,
  shutdown,
};
