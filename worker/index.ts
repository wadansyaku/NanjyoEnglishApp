import { dbAll, dbBind, dbPrepare, dbRun } from './db';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

type AuthContext = {
  userId: string;
};

type LookupRequest = {
  headwords: string[];
};

type CommitEntryInput = {
  headword: string;
  meaningJa: string;
  exampleEn?: string;
  note?: string;
};

type CommitRequest = {
  entries: CommitEntryInput[];
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

const badRequest = (message: string, details?: unknown) =>
  jsonResponse({ ok: false, message, details }, { status: 400 });

const LIMITS = {
  lookupMaxHeadwords: 200,
  commitMaxEntries: 50,
  meaningMax: 80,
  exampleMax: 160,
  noteMax: 160
} as const;

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

const hasNewline = (value: string) => /[\r\n]/.test(value);

const normalizeHeadword = (value: string) => {
  const lowered = value.toLowerCase();
  const parts = lowered.match(/[a-z']+/g);
  return parts ? parts.join('') : '';
};

const validateShortText = (value: string, max: number) => {
  if (hasNewline(value)) return `Newlines are not allowed (max ${max} chars).`;
  if (value.length > max) return `Must be ${max} characters or fewer.`;
  return null;
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

const handleLookup = async (request: Request, env: Env) => {
  let body: LookupRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  if (!Array.isArray(body.headwords)) {
    return badRequest('headwords must be an array.');
  }

  const uniqueMap = new Map<string, string>();
  for (const raw of body.headwords) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const norm = normalizeHeadword(trimmed);
    if (!norm) continue;
    if (!uniqueMap.has(norm)) {
      uniqueMap.set(norm, trimmed);
    }
  }

  const norms = [...uniqueMap.keys()];
  if (norms.length > LIMITS.lookupMaxHeadwords) {
    return badRequest(`headwords must be ${LIMITS.lookupMaxHeadwords} or fewer.`);
  }

  if (norms.length === 0) {
    return jsonResponse({ found: [], missing: [] });
  }

  const placeholders = norms.map((_, idx) => `?${idx + 1}`).join(',');
  const lexemeStmt = dbBind(
    dbPrepare(
      env.DB,
      `SELECT lexeme_id, headword, headword_norm, lemma, pos
       FROM lexemes
       WHERE headword_norm IN (${placeholders})`
    ),
    ...norms
  );
  const lexemeResult = await dbAll<{
    lexeme_id: number;
    headword: string;
    headword_norm: string;
    lemma: string | null;
    pos: string | null;
  }>(lexemeStmt);
  const lexemes = lexemeResult.results ?? [];

  const foundNorms = new Set(lexemes.map((lexeme) => lexeme.headword_norm));
  const missing = norms
    .filter((norm) => !foundNorms.has(norm))
    .map((norm) => uniqueMap.get(norm) ?? norm);

  if (lexemes.length === 0) {
    return jsonResponse({ found: [], missing });
  }

  const lexemeIds = lexemes.map((lexeme) => lexeme.lexeme_id);
  const entryPlaceholders = lexemeIds.map((_, idx) => `?${idx + 1}`).join(',');
  const entriesStmt = dbBind(
    dbPrepare(
      env.DB,
      `SELECT lexeme_id, meaning_ja, example_en, note
       FROM (
         SELECT lexeme_id, meaning_ja, example_en, note, created_at,
           ROW_NUMBER() OVER (PARTITION BY lexeme_id ORDER BY created_at DESC) AS rn
         FROM lexeme_entries
         WHERE lexeme_id IN (${entryPlaceholders}) AND scope_type = 'public'
       )
       WHERE rn <= 2
       ORDER BY lexeme_id, rn`
    ),
    ...lexemeIds
  );
  const entriesResult = await dbAll<{
    lexeme_id: number;
    meaning_ja: string | null;
    example_en: string | null;
    note: string | null;
  }>(entriesStmt);
  const entries = entriesResult.results ?? [];

  const entriesByLexeme = new Map<number, Array<{ meaning_ja: string; example_en?: string; note?: string }>>();
  for (const entry of entries) {
    if (!entriesByLexeme.has(entry.lexeme_id)) {
      entriesByLexeme.set(entry.lexeme_id, []);
    }
    entriesByLexeme.get(entry.lexeme_id)!.push({
      meaning_ja: entry.meaning_ja ?? '',
      ...(entry.example_en ? { example_en: entry.example_en } : {}),
      ...(entry.note ? { note: entry.note } : {})
    });
  }

  const found = lexemes.map((lexeme) => ({
    lexemeId: lexeme.lexeme_id,
    headword: lexeme.headword,
    headwordNorm: lexeme.headword_norm,
    ...(lexeme.lemma ? { lemma: lexeme.lemma } : {}),
    ...(lexeme.pos ? { pos: lexeme.pos } : {}),
    entries: entriesByLexeme.get(lexeme.lexeme_id) ?? []
  }));

  return jsonResponse({ found, missing });
};

const handleCommit = async (request: Request, env: Env, auth: AuthContext) => {
  let body: CommitRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  if (!Array.isArray(body.entries)) {
    return badRequest('entries must be an array.');
  }
  if (body.entries.length === 0) {
    return badRequest('entries must not be empty.');
  }
  if (body.entries.length > LIMITS.commitMaxEntries) {
    return badRequest(`entries must be ${LIMITS.commitMaxEntries} or fewer.`);
  }

  const errors: Array<{ index: number; message: string }> = [];
  const normalizedEntries: Array<{
    headword: string;
    headwordNorm: string;
    meaningJa: string;
    exampleEn: string;
    note: string;
  }> = [];

  body.entries.forEach((entry, index) => {
    if (!entry || typeof entry.headword !== 'string') {
      errors.push({ index, message: 'headword is required.' });
      return;
    }
    const headword = entry.headword.trim();
    const headwordNorm = normalizeHeadword(headword);
    if (!headwordNorm) {
      errors.push({ index, message: 'headword is invalid.' });
      return;
    }
    if (hasNewline(headword)) {
      errors.push({ index, message: 'headword must not contain newlines.' });
      return;
    }
    if (typeof entry.meaningJa !== 'string' || !entry.meaningJa.trim()) {
      errors.push({ index, message: 'meaningJa is required.' });
      return;
    }
    const meaningJa = entry.meaningJa.trim();
    const meaningError = validateShortText(meaningJa, LIMITS.meaningMax);
    if (meaningError) {
      errors.push({ index, message: `meaningJa: ${meaningError}` });
      return;
    }
    const exampleEn = entry.exampleEn?.trim() ?? '';
    if (exampleEn) {
      const exampleError = validateShortText(exampleEn, LIMITS.exampleMax);
      if (exampleError) {
        errors.push({ index, message: `exampleEn: ${exampleError}` });
        return;
      }
    }
    const note = entry.note?.trim() ?? '';
    if (note) {
      const noteError = validateShortText(note, LIMITS.noteMax);
      if (noteError) {
        errors.push({ index, message: `note: ${noteError}` });
        return;
      }
    }

    normalizedEntries.push({
      headword,
      headwordNorm,
      meaningJa,
      exampleEn,
      note
    });
  });

  if (errors.length > 0) {
    return badRequest('Validation failed.', { errors });
  }

  const headwordByNorm = new Map(
    normalizedEntries.map((entry) => [entry.headwordNorm, entry.headword])
  );
  const uniqueNorms = [...headwordByNorm.keys()];
  const createdAt = Date.now();

  const upsertStatement = `INSERT INTO lexemes (headword, headword_norm, lemma, pos, created_at, created_by)
    VALUES (?1, ?2, NULL, NULL, ?3, ?4)
    ON CONFLICT(headword_norm) DO UPDATE SET headword = excluded.headword`;

  const upsertBatch = uniqueNorms.map((norm) =>
    dbBind(dbPrepare(env.DB, upsertStatement), headwordByNorm.get(norm), norm, createdAt, auth.userId)
  );

  await env.DB.batch(upsertBatch);

  const normPlaceholders = uniqueNorms.map((_, idx) => `?${idx + 1}`).join(',');
  const lexemeIdStmt = dbBind(
    dbPrepare(
      env.DB,
      `SELECT lexeme_id, headword_norm
       FROM lexemes
       WHERE headword_norm IN (${normPlaceholders})`
    ),
    ...uniqueNorms
  );
  const lexemeIdResult = await dbAll<{ lexeme_id: number; headword_norm: string }>(lexemeIdStmt);
  const lexemeMap = new Map(
    (lexemeIdResult.results ?? []).map((row) => [row.headword_norm, row.lexeme_id])
  );

  if (lexemeMap.size !== uniqueNorms.length) {
    return jsonResponse(
      { ok: false, message: 'Failed to resolve lexeme ids.' },
      { status: 500 }
    );
  }

  const entryStatement = `INSERT INTO lexeme_entries
    (lexeme_id, scope_type, meaning_ja, example_en, note, created_at, created_by, status)
    VALUES (?1, 'public', ?2, NULLIF(?3, ''), NULLIF(?4, ''), ?5, ?6, 'active')`;

  const entryBatch = normalizedEntries.map((entry) =>
    dbBind(
      dbPrepare(env.DB, entryStatement),
      lexemeMap.get(entry.headwordNorm),
      entry.meaningJa,
      entry.exampleEn,
      entry.note,
      createdAt,
      auth.userId
    )
  );

  await env.DB.batch(entryBatch);

  return jsonResponse({ ok: true, inserted: normalizedEntries.length });
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

    if (url.pathname === '/api/v1/lexemes/lookup') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleLookup(request, env);
    }

    if (url.pathname === '/api/v1/lexemes/commit') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleCommit(request, env, auth);
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
