import { dbAll, dbBind, dbPrepare, dbRun } from './db';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_VISION_API_KEY?: string;
  GOOGLE_VISION_API_ENDPOINT?: string;
  CLOUD_OCR_DAILY_LIMIT?: string;
  AI_MEANING_DAILY_LIMIT?: string;
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  CF_AIG_ACCOUNT_ID?: string;
  CF_AIG_GATEWAY_ID?: string;
  CF_AIG_BASE_URL?: string;
  WORKERS_AI_API_TOKEN?: string;
  WORKERS_AI_ACCOUNT_ID?: string;
  WORKERS_AI_MODEL?: string;
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

type FeedbackRequest = {
  type: 'ocr' | 'ux' | 'bug' | 'feature';
  message: string;
  contextJson?: unknown;
};

type CloudOcrRequest = {
  imageBase64: string;
  mime: 'image/jpeg' | 'image/png';
  mode?: 'document' | 'text';
};

type AiMeaningSuggestRequest = {
  headwords: string[];
};

type UsageKind = 'cloud_ocr' | 'ai_meaning';

type OcrWord = {
  text: string;
  confidence?: number;
  bbox?: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
};

type AiSuggestion = {
  headword: string;
  meaningJa: string;
};

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const jsonResponse = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });

const unauthorized = () => jsonResponse({ ok: false, message: 'Unauthorized' }, { status: 401 });

const methodNotAllowed = () =>
  jsonResponse({ ok: false, message: 'Method not allowed' }, { status: 405 });

const badRequest = (message: string, details?: unknown) =>
  jsonResponse({ ok: false, message, details }, { status: 400 });

const tooManyRequests = (message: string) =>
  jsonResponse({ ok: false, message }, { status: 429 });

const serviceUnavailable = (message: string) =>
  jsonResponse({ ok: false, message }, { status: 503 });

const LIMITS = {
  lookupMaxHeadwords: 200,
  commitMaxEntries: 50,
  meaningMax: 80,
  exampleMax: 160,
  noteMax: 160,
  feedbackMessageMax: 200,
  feedbackContextMax: 2000,
  cloudImageMaxBytes: 2_000_000,
  cloudOcrMaxHeadwords: 300,
  cloudOcrMaxWords: 600,
  aiSuggestMaxHeadwords: 40,
  defaultCloudOcrDailyLimit: 20,
  defaultAiMeaningDailyLimit: 20
} as const;

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const randomToken = (bytes = 32) => bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));

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

const sanitizeSingleLine = (value: string) =>
  value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

const sanitizeMeaningJa = (value: string) =>
  sanitizeSingleLine(value).slice(0, LIMITS.meaningMax);

const validateContextJson = (value: unknown) => {
  if (value == null) return { ok: true, json: null as string | null };
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { ok: false, message: 'contextJson must be JSON serializable.' };
  }
  if (json.length > LIMITS.feedbackContextMax) {
    return { ok: false, message: `contextJson must be ${LIMITS.feedbackContextMax} chars or fewer.` };
  }
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === 'string') {
      if (hasNewline(current)) {
        return { ok: false, message: 'contextJson must not contain newlines.' };
      }
      if (current.length > LIMITS.feedbackMessageMax) {
        return {
          ok: false,
          message: `contextJson string fields must be ${LIMITS.feedbackMessageMax} chars or fewer.`
        };
      }
    } else if (Array.isArray(current)) {
      stack.push(...current);
    } else if (current && typeof current === 'object') {
      stack.push(...Object.values(current as Record<string, unknown>));
    }
  }
  return { ok: true, json };
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

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const getUsageLimit = (env: Env, kind: UsageKind) => {
  if (kind === 'cloud_ocr') {
    return parsePositiveInt(env.CLOUD_OCR_DAILY_LIMIT, LIMITS.defaultCloudOcrDailyLimit);
  }
  return parsePositiveInt(env.AI_MEANING_DAILY_LIMIT, LIMITS.defaultAiMeaningDailyLimit);
};

const getUsageDateKey = () => new Date().toISOString().slice(0, 10);

const consumeDailyQuota = async (
  env: Env,
  userId: string,
  kind: UsageKind,
  limit: number
): Promise<boolean> => {
  const dateKey = getUsageDateKey();
  const now = Date.now();
  const column = kind === 'cloud_ocr' ? 'cloud_ocr_calls_today' : 'ai_meaning_calls_today';

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO usage_daily (user_id, usage_date, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id, usage_date) DO UPDATE SET updated_at = excluded.updated_at`
      ),
      userId,
      dateKey,
      now
    )
  );

  const updateStmt = dbBind(
    dbPrepare(
      env.DB,
      `UPDATE usage_daily
       SET ${column} = ${column} + 1,
           updated_at = ?3
       WHERE user_id = ?1
         AND usage_date = ?2
         AND ${column} < ?4`
    ),
    userId,
    dateKey,
    now,
    limit
  );

  const updateResult = await dbRun(updateStmt);
  const changes = Number((updateResult as { meta?: { changes?: number } }).meta?.changes ?? 0);
  return changes > 0;
};

const estimateBase64Bytes = (base64: string) => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

const parseImagePayload = (input: CloudOcrRequest) => {
  let mime = input.mime;
  let base64 = input.imageBase64.trim();

  const dataUrlMatch = /^data:(image\/(?:jpeg|png));base64,(.+)$/i.exec(base64);
  if (dataUrlMatch) {
    mime = dataUrlMatch[1].toLowerCase() as 'image/jpeg' | 'image/png';
    base64 = dataUrlMatch[2];
  }

  if (mime !== 'image/jpeg' && mime !== 'image/png') {
    return { ok: false as const, message: 'mime must be image/jpeg or image/png.' };
  }

  base64 = base64.replace(/\s+/g, '');
  if (!base64) {
    return { ok: false as const, message: 'imageBase64 is required.' };
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(base64)) {
    return { ok: false as const, message: 'imageBase64 is invalid.' };
  }

  const bytes = estimateBase64Bytes(base64);
  if (bytes <= 0) {
    return { ok: false as const, message: 'imageBase64 is empty.' };
  }
  if (bytes > LIMITS.cloudImageMaxBytes) {
    return {
      ok: false as const,
      message: `imageBase64 is too large (max ${LIMITS.cloudImageMaxBytes} bytes).`
    };
  }

  return {
    ok: true as const,
    mime,
    base64
  };
};

const toBbox = (vertices: Array<{ x?: number; y?: number }> | undefined) => {
  if (!vertices || vertices.length === 0) return undefined;
  const xs = vertices
    .map((vertex) => (typeof vertex.x === 'number' ? vertex.x : 0))
    .filter((value) => Number.isFinite(value));
  const ys = vertices
    .map((vertex) => (typeof vertex.y === 'number' ? vertex.y : 0))
    .filter((value) => Number.isFinite(value));
  if (xs.length === 0 || ys.length === 0) return undefined;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY)
  };
};

const extractWordsFromVision = (payload: unknown): OcrWord[] => {
  const response = (payload as { responses?: unknown[] })?.responses?.[0] as
    | {
        fullTextAnnotation?: {
          pages?: Array<{
            blocks?: Array<{
              paragraphs?: Array<{
                words?: Array<{
                  symbols?: Array<{ text?: string }>;
                  confidence?: number;
                  boundingBox?: { vertices?: Array<{ x?: number; y?: number }> };
                }>;
              }>;
            }>;
          }>;
        };
        textAnnotations?: Array<{
          description?: string;
          boundingPoly?: { vertices?: Array<{ x?: number; y?: number }> };
        }>;
      }
    | undefined;

  const words: OcrWord[] = [];

  const pages = response?.fullTextAnnotation?.pages ?? [];
  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = sanitizeSingleLine((word.symbols ?? []).map((symbol) => symbol.text ?? '').join(''));
          if (!text) continue;
          const confidence =
            typeof word.confidence === 'number' && Number.isFinite(word.confidence)
              ? Math.max(0, Math.min(1, word.confidence))
              : undefined;
          words.push({
            text,
            ...(typeof confidence === 'number' ? { confidence } : {}),
            ...(word.boundingBox?.vertices ? { bbox: toBbox(word.boundingBox.vertices) } : {})
          });
        }
      }
    }
  }

  if (words.length > 0) {
    return words.slice(0, LIMITS.cloudOcrMaxWords);
  }

  const textAnnotations = response?.textAnnotations ?? [];
  for (let index = 1; index < textAnnotations.length; index += 1) {
    const annotation = textAnnotations[index];
    const text = sanitizeSingleLine(annotation.description ?? '');
    if (!text) continue;
    words.push({
      text,
      ...(annotation.boundingPoly?.vertices ? { bbox: toBbox(annotation.boundingPoly.vertices) } : {})
    });
  }

  return words.slice(0, LIMITS.cloudOcrMaxWords);
};

const buildHeadwordsFromWords = (words: OcrWord[]) => {
  const counts = new Map<string, number>();
  for (const word of words) {
    const normalized = normalizeHeadword(word.text);
    if (!normalized || normalized.length < 2) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, LIMITS.cloudOcrMaxHeadwords)
    .map(([headword]) => headword);
};

const fetchGoogleVisionWords = async (
  env: Env,
  imageBase64: string,
  mode: 'document' | 'text'
): Promise<OcrWord[]> => {
  const apiKey = env.GOOGLE_VISION_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(503, 'Cloud OCR is not configured.');
  }

  const endpoint = env.GOOGLE_VISION_API_ENDPOINT?.trim() || 'https://vision.googleapis.com/v1/images:annotate';
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
  const featureType = mode === 'text' ? 'TEXT_DETECTION' : 'DOCUMENT_TEXT_DETECTION';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: featureType }]
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };

  if (!response.ok || payload.error) {
    const message = payload.error?.message?.slice(0, 160) || 'Cloud OCR provider request failed.';
    throw new HttpError(502, message);
  }

  return extractWordsFromVision(payload);
};

const extractJsonObject = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }
    throw new Error('JSON parse failed.');
  }
};

const normalizeAiSuggestions = (payload: unknown, requested: Set<string>): AiSuggestion[] => {
  const rawSuggestions = (payload as { suggestions?: unknown[] })?.suggestions;
  if (!Array.isArray(rawSuggestions)) return [];

  const map = new Map<string, string>();
  for (const item of rawSuggestions) {
    const headwordRaw = (item as { headword?: unknown })?.headword;
    const meaningRaw = (item as { meaningJa?: unknown })?.meaningJa;
    if (typeof headwordRaw !== 'string' || typeof meaningRaw !== 'string') continue;

    const headword = normalizeHeadword(headwordRaw);
    if (!headword || !requested.has(headword)) continue;

    const meaningJa = sanitizeMeaningJa(meaningRaw);
    if (!meaningJa) continue;

    if (!map.has(headword)) {
      map.set(headword, meaningJa);
    }
  }

  return [...map.entries()].map(([headword, meaningJa]) => ({ headword, meaningJa }));
};

const getOpenAiEndpoint = (env: Env) => {
  if (env.CF_AIG_BASE_URL?.trim()) {
    const base = env.CF_AIG_BASE_URL.trim().replace(/\/$/, '');
    return `${base}/openai/chat/completions`;
  }
  if (env.CF_AIG_ACCOUNT_ID?.trim() && env.CF_AIG_GATEWAY_ID?.trim()) {
    return `https://gateway.ai.cloudflare.com/v1/${env.CF_AIG_ACCOUNT_ID.trim()}/${env.CF_AIG_GATEWAY_ID.trim()}/openai/chat/completions`;
  }
  return 'https://api.openai.com/v1/chat/completions';
};

const suggestMeaningsWithOpenAi = async (env: Env, headwords: string[]): Promise<AiSuggestion[]> => {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(503, 'AI meaning suggestion is not configured.');
  }

  const endpoint = getOpenAiEndpoint(env);
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const requestedSet = new Set(headwords);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are an English-to-Japanese dictionary assistant for junior-high students. Return JSON only with this exact shape: {"suggestions":[{"headword":"string","meaningJa":"string"}]}. Rules: meaningJa must be <= 80 chars, single-line, no newlines, no examples, no long translations, no paragraphs. Only include provided headwords.'
        },
        {
          role: 'user',
          content: JSON.stringify({ headwords })
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok || payload.error) {
    const message = payload.error?.message?.slice(0, 160) || 'AI provider request failed.';
    throw new HttpError(502, message);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new HttpError(502, 'AI provider returned empty response.');
  }

  const parsed = extractJsonObject(content);
  return normalizeAiSuggestions(parsed, requestedSet);
};

const suggestMeaningsWithWorkersAi = async (env: Env, headwords: string[]): Promise<AiSuggestion[]> => {
  const apiToken = env.WORKERS_AI_API_TOKEN?.trim();
  const accountId = env.WORKERS_AI_ACCOUNT_ID?.trim();
  if (!apiToken || !accountId) {
    throw new HttpError(503, 'Workers AI settings are missing.');
  }

  const model = env.WORKERS_AI_MODEL?.trim() || '@cf/meta/llama-3.1-8b-instruct';
  const requestedSet = new Set(headwords);

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiToken}`
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            'Return JSON only: {"suggestions":[{"headword":"string","meaningJa":"string"}]}. meaningJa must be <=80 chars, one line, no examples, no long explanations. Only use provided English headwords.'
        },
        {
          role: 'user',
          content: JSON.stringify({ headwords })
        }
      ],
      temperature: 0.2,
      max_tokens: 400
    })
  });

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { response?: string };
  };

  if (!response.ok || payload.success === false) {
    const message = payload.errors?.[0]?.message?.slice(0, 160) || 'Workers AI request failed.';
    throw new HttpError(502, message);
  }

  const content = payload.result?.response;
  if (!content) {
    throw new HttpError(502, 'Workers AI returned empty response.');
  }

  const parsed = extractJsonObject(content);
  return normalizeAiSuggestions(parsed, requestedSet);
};

const suggestMeanings = async (env: Env, headwords: string[]) => {
  const provider = (env.AI_PROVIDER?.trim().toLowerCase() || 'openai') as 'openai' | 'workers_ai';

  if (provider === 'workers_ai') {
    return suggestMeaningsWithWorkersAi(env, headwords);
  }
  return suggestMeaningsWithOpenAi(env, headwords);
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

  const headwordByNorm = new Map(normalizedEntries.map((entry) => [entry.headwordNorm, entry.headword]));
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
  const lexemeMap = new Map((lexemeIdResult.results ?? []).map((row) => [row.headword_norm, row.lexeme_id]));

  if (lexemeMap.size !== uniqueNorms.length) {
    return jsonResponse({ ok: false, message: 'Failed to resolve lexeme ids.' }, { status: 500 });
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

const handleFeedback = async (request: Request, env: Env, auth: AuthContext) => {
  let body: FeedbackRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  if (!body || typeof body.message !== 'string' || typeof body.type !== 'string') {
    return badRequest('type and message are required.');
  }
  const type = body.type;
  if (!['ocr', 'ux', 'bug', 'feature'].includes(type)) {
    return badRequest('type is invalid.');
  }
  const message = body.message.trim();
  if (!message) {
    return badRequest('message is required.');
  }
  const messageError = validateShortText(message, LIMITS.feedbackMessageMax);
  if (messageError) {
    return badRequest(messageError);
  }
  const contextCheck = validateContextJson(body.contextJson);
  if (!contextCheck.ok) {
    return badRequest(contextCheck.message ?? 'contextJson is invalid.');
  }

  const stmt = dbBind(
    dbPrepare(
      env.DB,
      `INSERT INTO feedback (type, message, context_json, created_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5)`
    ),
    type,
    message,
    contextCheck.json,
    Date.now(),
    auth.userId
  );
  await dbRun(stmt);
  return jsonResponse({ ok: true });
};

const handleCloudOcr = async (request: Request, env: Env, auth: AuthContext) => {
  let body: CloudOcrRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  if (!body || typeof body.imageBase64 !== 'string' || typeof body.mime !== 'string') {
    return badRequest('imageBase64 and mime are required.');
  }

  const parsedImage = parseImagePayload(body);
  if (!parsedImage.ok) {
    return badRequest(parsedImage.message);
  }

  const mode = body.mode === 'text' ? 'text' : 'document';

  if (!env.GOOGLE_VISION_API_KEY?.trim()) {
    return serviceUnavailable('Cloud OCR is not configured on this deployment.');
  }

  const limit = getUsageLimit(env, 'cloud_ocr');
  const allowed = await consumeDailyQuota(env, auth.userId, 'cloud_ocr', limit);
  if (!allowed) {
    return tooManyRequests(`Daily cloud OCR limit reached (${limit}/day).`);
  }

  try {
    const words = await fetchGoogleVisionWords(env, parsedImage.base64, mode);
    const headwords = buildHeadwordsFromWords(words);
    return jsonResponse({ words, headwords });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, message: error.message }, { status: error.status });
    }
    return jsonResponse({ ok: false, message: 'Cloud OCR request failed.' }, { status: 502 });
  }
};

const handleAiMeaningSuggest = async (request: Request, env: Env, auth: AuthContext) => {
  let body: AiMeaningSuggestRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  if (!body || !Array.isArray(body.headwords)) {
    return badRequest('headwords must be an array.');
  }

  const uniqueHeadwords = new Set<string>();
  for (const raw of body.headwords) {
    if (typeof raw !== 'string') continue;
    const normalized = normalizeHeadword(raw);
    if (!normalized) continue;
    uniqueHeadwords.add(normalized);
  }

  const headwords = [...uniqueHeadwords];
  if (headwords.length === 0) {
    return jsonResponse({ suggestions: [] });
  }

  if (headwords.length > LIMITS.aiSuggestMaxHeadwords) {
    return badRequest(`headwords must be ${LIMITS.aiSuggestMaxHeadwords} or fewer.`);
  }

  const provider = (env.AI_PROVIDER?.trim().toLowerCase() || 'openai') as string;
  if (provider === 'openai' && !env.OPENAI_API_KEY?.trim()) {
    return serviceUnavailable('AI meaning suggestion is not configured on this deployment.');
  }
  if (provider === 'workers_ai' && (!env.WORKERS_AI_API_TOKEN?.trim() || !env.WORKERS_AI_ACCOUNT_ID?.trim())) {
    return serviceUnavailable('Workers AI meaning suggestion is not configured on this deployment.');
  }

  const limit = getUsageLimit(env, 'ai_meaning');
  const allowed = await consumeDailyQuota(env, auth.userId, 'ai_meaning', limit);
  if (!allowed) {
    return tooManyRequests(`Daily AI meaning limit reached (${limit}/day).`);
  }

  try {
    const suggestions = await suggestMeanings(env, headwords);
    return jsonResponse({ suggestions });
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, message: error.message }, { status: error.status });
    }
    return jsonResponse({ ok: false, message: 'AI meaning suggestion failed.' }, { status: 502 });
  }
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

    if (url.pathname === '/api/v1/feedback') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleFeedback(request, env, auth);
    }

    if (url.pathname === '/api/v1/ocr/cloud') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleCloudOcr(request, env, auth);
    }

    if (url.pathname === '/api/v1/ai/meaning-suggest') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleAiMeaningSuggest(request, env, auth);
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
