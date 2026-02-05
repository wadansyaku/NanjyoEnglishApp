import { dbAll, dbBind, dbPrepare, dbRun } from './db';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type AuthContext = {
  userId: string;
};

const jsonResponse = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });

const unauthorized = () =>
  jsonResponse({ ok: false, message: 'Unauthorized' }, { status: 401 });

const methodNotAllowed = () =>
  jsonResponse({ ok: false, message: 'Method not allowed' }, { status: 405 });

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const randomToken = (bytes = 32) =>
  bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));

const hashApiKey = async (apiKey: string) => {
  const data = new TextEncoder().encode(apiKey);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
};

const parseBearer = (headerValue: string | null) => {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
};

const requireAuth = async (request: Request, env: Env): Promise<AuthContext | null> => {
  const apiKey = parseBearer(request.headers.get('Authorization'));
  if (!apiKey) return null;
  const apiKeyHash = await hashApiKey(apiKey);
  const stmt = dbBind(dbPrepare(env.DB, 'SELECT user_id FROM users WHERE api_key_hash = ?1'), apiKeyHash);
  const result = await dbAll<{ user_id: string }>(stmt);
  const userId = result.results?.[0]?.user_id;
  return userId ? { userId } : null;
};

const handleBootstrap = async (env: Env) => {
  const userId = crypto.randomUUID();
  const apiKey = randomToken(32);
  const apiKeyHash = await hashApiKey(apiKey);
  const avatarSeed = randomToken(8);
  const createdAt = Date.now();

  const stmt = dbBind(
    dbPrepare(
      env.DB,
      `INSERT INTO users (user_id, created_at, avatar_seed, api_key_hash, xp_total, level)
       VALUES (?1, ?2, ?3, ?4, 0, 1)`
    ),
    userId,
    createdAt,
    avatarSeed,
    apiKeyHash
  );
  await dbRun(stmt);

  return jsonResponse({ ok: true, userId, apiKey, avatarSeed });
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/healthz') {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === '/api/v1/bootstrap') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleBootstrap(env);
    }

    if (url.pathname === '/api/v1/lexemes/batch' && request.method === 'POST') {
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return jsonResponse({ ok: true });
    }

    if (url.pathname.startsWith('/api/v1/lexemes/')) {
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
