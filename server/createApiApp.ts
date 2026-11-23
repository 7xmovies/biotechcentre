import express from 'express';
import {
  ALLOWED_RPCS,
  ALLOWED_TABLES,
  githubDb,
  type QueryPayload,
  type RpcName,
} from './githubDb.ts';
import {
  checkRateLimit,
  claimInitialPassword,
  clearRateLimit,
  createSessionToken,
  getAuthStatus,
  requireAuth,
  verifyPassword,
  verifySessionToken,
} from './auth.ts';

export function createApiRouter() {
  const router = express.Router();

  // --- Auth Routes ---
  router.get('/auth/status', async (req, res) => {
    try {
      const status = await getAuthStatus();
      const authHeader = req.headers.authorization || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const authenticated = Boolean(match && verifySessionToken(match[1]));
      res.json({ ...status, authenticated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post('/auth/setup', async (req, res) => {
    try {
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const token = await claimInitialPassword(password);
      res.json({ token });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  router.post('/auth/login', async (req, res) => {
    try {
      const ip =
        (typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for'].split(',')[0].trim()
          : '') ||
        req.ip ||
        req.socket?.remoteAddress ||
        'unknown';

      if (!checkRateLimit(ip)) {
        res.status(429).json({ error: 'Too many login attempts. Please wait a few minutes.' });
        return;
      }

      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const ok = await verifyPassword(password);
      if (!ok) {
        res.status(401).json({ error: 'Incorrect password. Please try again.' });
        return;
      }

      clearRateLimit(ip);
      const token = createSessionToken();
      res.json({ token });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // --- Database Routes (Protected) ---
  router.get('/db/status', requireAuth, async (_req, res) => {
    try {
      const status = await githubDb.getStatus();
      res.json(status);
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
    }
  });

  router.post('/db/sync', requireAuth, async (_req, res) => {
    try {
      const status = await githubDb.syncAll();
      res.json(status);
    } catch (err) {
      res.status(503).json({ error: (err as Error).message });
    }
  });

  router.post('/db/query', requireAuth, async (req, res) => {
    try {
      const payload = req.body as QueryPayload;
      if (!payload || !ALLOWED_TABLES.includes(payload.table)) {
        res.status(400).json({ data: null, error: { message: 'Invalid table name' } });
        return;
      }
      if (!['select', 'insert', 'update', 'upsert', 'delete'].includes(payload.action)) {
        res.status(400).json({ data: null, error: { message: 'Invalid query action' } });
        return;
      }

      const result = await githubDb.executeQuery(payload);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        data: null,
        error: { message: (err as Error).message || 'Database query failed' },
      });
    }
  });

  router.post('/db/rpc', requireAuth, async (req, res) => {
    try {
      const name = req.body?.name as RpcName;
      const params = (req.body?.params || {}) as Record<string, unknown>;
      if (!name || !ALLOWED_RPCS.includes(name)) {
        res.status(400).json({ data: null, error: { message: 'Invalid RPC name' } });
        return;
      }

      const result = await githubDb.executeRpc(name, params);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        data: null,
        error: { message: (err as Error).message || 'Database RPC failed' },
      });
    }
  });

  return router;
}

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const apiRouter = createApiRouter();
  app.use('/api', apiRouter);
  app.use('/.netlify/functions/api', apiRouter);

  return app;
}
