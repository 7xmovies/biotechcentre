import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { githubDb, isGitHubConfigured } from './githubDb.ts';

interface StoredAuthConfig {
  salt: string;
  hash: string;
  createdAt: string;
}

const FALLBACK_RANDOM_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  const explicit = (process.env.SESSION_SECRET || '').trim();
  if (explicit) return explicit;

  const ghToken = (process.env.GITHUB_TOKEN || '').trim();
  const appPass = (process.env.APP_PASSWORD || '').trim();
  if (ghToken || appPass) {
    // Keeps session signatures consistent across stateless serverless invocations
    return crypto
      .createHash('sha256')
      .update(`biotechcentre-session-v1:${ghToken}:${appPass}`)
      .digest('hex');
  }
  return FALLBACK_RANDOM_SECRET;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const AUTH_FILE_PATH = 'data/_auth.json';

let cachedStoredAuth: StoredAuthConfig | null | undefined = undefined;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform a dummy comparison to keep timing consistent
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function getEnvPassword(): string {
  return (process.env.APP_PASSWORD || '').trim();
}

async function getStoredAuth(): Promise<StoredAuthConfig | null> {
  if (cachedStoredAuth !== undefined) {
    return cachedStoredAuth;
  }
  try {
    const stored = await githubDb.readAuxFile<StoredAuthConfig>(AUTH_FILE_PATH);
    if (stored && typeof stored.salt === 'string' && typeof stored.hash === 'string') {
      cachedStoredAuth = stored;
      return stored;
    }
  } catch (err) {
    console.warn('[auth] Could not read stored auth config from GitHub:', (err as Error).message);
  }
  cachedStoredAuth = null;
  return null;
}

export async function getAuthStatus(): Promise<{
  setupRequired: boolean;
  githubConfigured: boolean;
}> {
  const envPassword = getEnvPassword();
  if (envPassword) {
    return { setupRequired: false, githubConfigured: isGitHubConfigured() };
  }
  const stored = await getStoredAuth();
  return { setupRequired: !stored, githubConfigured: isGitHubConfigured() };
}

export async function claimInitialPassword(password: string): Promise<string> {
  if (getEnvPassword()) {
    throw new Error('Password is already configured via environment secrets.');
  }
  const existing = await getStoredAuth();
  if (existing) {
    throw new Error('Admin password has already been set.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters long.');
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const record: StoredAuthConfig = {
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };

  cachedStoredAuth = record;
  if (isGitHubConfigured()) {
    await githubDb.writeAuxFile(AUTH_FILE_PATH, record, 'Initialize admin password hash');
  }
  return createSessionToken();
}

export async function verifyPassword(password: string): Promise<boolean> {
  if (!password) return false;
  const envPassword = getEnvPassword();
  if (envPassword) {
    return timingSafeStringEqual(password, envPassword);
  }
  const stored = await getStoredAuth();
  if (!stored) {
    return false;
  }
  const candidate = hashPassword(password, stored.salt);
  return timingSafeStringEqual(candidate, stored.hash);
}

export function createSessionToken(): string {
  const payload = {
    sub: 'admin',
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  if (!timingSafeStringEqual(sig, expectedSig)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (!payload.exp || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 20;
}

export function clearRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !verifySessionToken(match[1])) {
    res.status(401).json({ data: null, error: { message: 'Unauthorized. Please sign in again.' } });
    return;
  }
  next();
}
