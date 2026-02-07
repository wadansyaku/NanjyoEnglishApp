import { dbAll, dbBind, dbPrepare, dbRun } from './db';
import { normalizeHeadword } from '../shared/headword';

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
  APP_URL?: string;
  ADMIN_TOKEN?: string;
  ALLOW_DEV_MAGIC_LINK?: string;
  PROOFREAD_TOKEN_MAX?: string;
}

type AuthContext = {
  userId: string;
  email?: string | null;
};

type MagicLinkRequest = {
  email: string;
};

type LinkAccountRequest = {
  email: string;
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

type WordbankAdminUpsertRequest = {
  words?: Array<{
    headword: string;
    meaningJaShort: string;
    pos?: string;
    level?: string;
    tagsJson?: unknown;
    source?: string;
  }>;
  decks?: Array<{
    deckId: string;
    title: string;
    description?: string;
    source?: string;
    headwordNorms?: string[];
  }>;
};

type CreateChangesetRequest = {
  title: string;
  description?: string;
};

type AddChangesetItemsRequest = {
  items: Array<{
    headword: string;
    meaningJaShort?: string;
    exampleEnShort?: string;
    noteShort?: string;
  }>;
};

type SubmitChangesetRequest = {
  note?: string;
};

type ReviewChangesetRequest = {
  action: 'approve' | 'request_changes' | 'comment';
  comment?: string;
};

type MergeChangesetRequest = {
  note?: string;
};

type UsageReportRequest = {
  minutesToday: number;
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

const forbidden = (message = 'Forbidden') =>
  jsonResponse({ ok: false, message }, { status: 403 });

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
  defaultAiMeaningDailyLimit: 20,
  changesetItemsMax: 100,
  usageMinutesMax: 24 * 60,
  maxProofreadTokens: 20
} as const;

const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const randomToken = (bytes = 32) => bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));

const hashSha256 = async (value: string) => {
  const data = new TextEncoder().encode(value);
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

const validateShortText = (value: string, max: number) => {
  if (hasNewline(value)) return `Newlines are not allowed (max ${max} chars).`;
  if (value.length > max) return `Must be ${max} characters or fewer.`;
  return null;
};

const sanitizeSingleLine = (value: string) =>
  value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

const sanitizeMeaningJa = (value: string) =>
  sanitizeSingleLine(value).slice(0, LIMITS.meaningMax);

const parsePositiveInt = (raw: string | undefined, fallback: number) => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
};

const parseBoolean = (raw: string | undefined, fallback = false) => {
  if (!raw) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
};

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
  const apiKeyHash = await hashSha256(apiKey);
  const stmt = dbBind(
    dbPrepare(env.DB, 'SELECT user_id, email FROM users WHERE api_key_hash = ?1'),
    apiKeyHash
  );
  const result = await dbAll<{ user_id: string; email: string | null }>(stmt);
  const row = result.results?.[0];
  if (!row?.user_id) return null;
  return { userId: row.user_id, email: row.email };
};

const requireAdmin = (request: Request, env: Env) => {
  const configured = env.ADMIN_TOKEN?.trim();
  if (!configured) return false;
  const headerToken = request.headers.get('x-admin-token')?.trim();
  const bearer = parseBearer(request.headers.get('Authorization'));
  return headerToken === configured || bearer === configured;
};

const getUsageLimit = (env: Env, kind: UsageKind) => {
  if (kind === 'cloud_ocr') {
    return parsePositiveInt(env.CLOUD_OCR_DAILY_LIMIT, LIMITS.defaultCloudOcrDailyLimit);
  }
  return parsePositiveInt(env.AI_MEANING_DAILY_LIMIT, LIMITS.defaultAiMeaningDailyLimit);
};

const getUsageDateKey = () => new Date().toISOString().slice(0, 10);

const ensureUsageRow = async (env: Env, userId: string, dateKey: string) => {
  const now = Date.now();
  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO usage_daily (
           user_id,
           usage_date,
           cloud_ocr_calls_today,
           ai_meaning_calls_today,
           minutes_today,
           proofread_tokens_today,
           proofread_used_today,
           updated_at
         )
         VALUES (?1, ?2, 0, 0, 0, 1, 0, ?3)
         ON CONFLICT(user_id, usage_date) DO UPDATE SET updated_at = excluded.updated_at`
      ),
      userId,
      dateKey,
      now
    )
  );
};

const consumeDailyQuota = async (
  env: Env,
  userId: string,
  kind: UsageKind,
  limit: number
): Promise<boolean> => {
  const dateKey = getUsageDateKey();
  const now = Date.now();
  const column = kind === 'cloud_ocr' ? 'cloud_ocr_calls_today' : 'ai_meaning_calls_today';

  await ensureUsageRow(env, userId, dateKey);

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

const consumeProofreadToken = async (env: Env, userId: string): Promise<boolean> => {
  const dateKey = getUsageDateKey();
  await ensureUsageRow(env, userId, dateKey);
  const now = Date.now();
  const result = await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `UPDATE usage_daily
         SET proofread_used_today = proofread_used_today + 1,
             updated_at = ?3
         WHERE user_id = ?1
           AND usage_date = ?2
           AND proofread_used_today < proofread_tokens_today`
      ),
      userId,
      dateKey,
      now
    )
  );
  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
  return changes > 0;
};

const getUsageSnapshot = async (env: Env, userId: string) => {
  const dateKey = getUsageDateKey();
  await ensureUsageRow(env, userId, dateKey);
  const result = await dbAll<{
    minutes_today: number;
    proofread_tokens_today: number;
    proofread_used_today: number;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT minutes_today, proofread_tokens_today, proofread_used_today
         FROM usage_daily
         WHERE user_id = ?1 AND usage_date = ?2`
      ),
      userId,
      dateKey
    )
  );
  const row = result.results?.[0] ?? {
    minutes_today: 0,
    proofread_tokens_today: 1,
    proofread_used_today: 0
  };
  return {
    date: dateKey,
    minutesToday: row.minutes_today,
    proofreadTokensToday: row.proofread_tokens_today,
    proofreadUsedToday: row.proofread_used_today,
    proofreadRemainingToday: Math.max(0, row.proofread_tokens_today - row.proofread_used_today)
  };
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

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const shouldExposeDevMagicLink = (env: Env) => parseBoolean(env.ALLOW_DEV_MAGIC_LINK, false);

const MAGIC_LINK_EXPIRY_MS = 15 * 60 * 1000;

type AuthTokenRow = {
  email: string;
  expires_at: number;
  used_at: number | null;
  purpose: 'signin' | 'link';
  target_user_id: string | null;
};

const issueMagicLinkToken = async (env: Env, input: {
  email: string;
  purpose: 'signin' | 'link';
  targetUserId?: string;
}) => {
  const rawToken = randomToken(32);
  const tokenHash = await hashSha256(rawToken);
  const expiresAt = Date.now() + MAGIC_LINK_EXPIRY_MS;

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO auth_tokens (token_hash, email, purpose, target_user_id, expires_at, used_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)`
      ),
      tokenHash,
      input.email,
      input.purpose,
      input.targetUserId ?? null,
      expiresAt,
      Date.now()
    )
  );

  return rawToken;
};

const consumeMagicLinkToken = async (env: Env, rawToken: string) => {
  const tokenHash = await hashSha256(rawToken);
  const result = await dbAll<AuthTokenRow>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT email, expires_at, used_at, purpose, target_user_id
         FROM auth_tokens
         WHERE token_hash = ?1`
      ),
      tokenHash
    )
  );
  const row = result.results?.[0];
  if (!row) return null;
  const now = Date.now();
  if (row.used_at) return null;
  if (row.expires_at < now) return null;

  await dbRun(
    dbBind(
      dbPrepare(env.DB, 'UPDATE auth_tokens SET used_at = ?1 WHERE token_hash = ?2'),
      now,
      tokenHash
    )
  );
  return row;
};

const createUserWithApiKey = async (env: Env, input: {
  email?: string | null;
  emailVerifiedAt?: number | null;
}) => {
  const userId = crypto.randomUUID();
  const apiKey = randomToken(32);
  const apiKeyHash = await hashSha256(apiKey);
  const avatarSeed = randomToken(8);
  const createdAt = Date.now();

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO users
           (user_id, email, email_verified_at, created_at, avatar_seed, api_key_hash, xp_total, level)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1)`
      ),
      userId,
      input.email ?? null,
      input.emailVerifiedAt ?? null,
      createdAt,
      avatarSeed,
      apiKeyHash
    )
  );

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO user_progress (user_id, xp_total, level, streak_days, synced_at)
         VALUES (?1, 0, 1, 0, ?2)
         ON CONFLICT(user_id) DO NOTHING`
      ),
      userId,
      createdAt
    )
  );

  return { userId, apiKey, avatarSeed };
};

const rotateApiKey = async (env: Env, userId: string) => {
  const apiKey = randomToken(32);
  const apiKeyHash = await hashSha256(apiKey);
  await dbRun(
    dbBind(
      dbPrepare(env.DB, 'UPDATE users SET api_key_hash = ?1 WHERE user_id = ?2'),
      apiKeyHash,
      userId
    )
  );
  return apiKey;
};

const validateMeaningFields = (input: {
  meaningJaShort?: string;
  exampleEnShort?: string;
  noteShort?: string;
}) => {
  const out = {
    meaningJaShort: sanitizeSingleLine(input.meaningJaShort ?? ''),
    exampleEnShort: sanitizeSingleLine(input.exampleEnShort ?? ''),
    noteShort: sanitizeSingleLine(input.noteShort ?? '')
  };

  if (out.meaningJaShort) {
    const err = validateShortText(out.meaningJaShort, LIMITS.meaningMax);
    if (err) return { ok: false as const, message: `meaningJaShort: ${err}` };
  }
  if (out.exampleEnShort) {
    const err = validateShortText(out.exampleEnShort, LIMITS.exampleMax);
    if (err) return { ok: false as const, message: `exampleEnShort: ${err}` };
  }
  if (out.noteShort) {
    const err = validateShortText(out.noteShort, LIMITS.noteMax);
    if (err) return { ok: false as const, message: `noteShort: ${err}` };
  }

  return { ok: true as const, value: out };
};

const parseCsvLine = (line: string) => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
};

const parseWordbankCsvPayload = (raw: string): WordbankAdminUpsertRequest => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    throw new HttpError(400, 'CSV must include header and at least one row.');
  }

  const header = parseCsvLine(lines[0]).map((field) => field.toLowerCase());
  const indexOf = (name: string) => header.indexOf(name);
  const headwordIdx = indexOf('headword');
  const meaningIdx = indexOf('meaningjashort');
  if (headwordIdx < 0 || meaningIdx < 0) {
    throw new HttpError(400, 'CSV header must include headword,meaningJaShort.');
  }

  const posIdx = indexOf('pos');
  const levelIdx = indexOf('level');
  const sourceIdx = indexOf('source');
  const tagsIdx = indexOf('tagsjson');
  const deckIdIdx = indexOf('deckid');
  const deckTitleIdx = indexOf('decktitle');
  const deckDescriptionIdx = indexOf('deckdescription');
  const deckSourceIdx = indexOf('decksource');

  const words: NonNullable<WordbankAdminUpsertRequest['words']> = [];
  const decksMap = new Map<
    string,
    {
      deckId: string;
      title: string;
      description?: string;
      source?: string;
      headwordNorms: string[];
    }
  >();

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    const headword = row[headwordIdx] ?? '';
    const meaningJaShort = row[meaningIdx] ?? '';
    if (!headword || !meaningJaShort) continue;

    words.push({
      headword,
      meaningJaShort,
      ...(posIdx >= 0 && row[posIdx] ? { pos: row[posIdx] } : {}),
      ...(levelIdx >= 0 && row[levelIdx] ? { level: row[levelIdx] } : {}),
      ...(sourceIdx >= 0 && row[sourceIdx] ? { source: row[sourceIdx] } : {}),
      ...(tagsIdx >= 0 && row[tagsIdx]
        ? (() => {
          try {
            return { tagsJson: JSON.parse(row[tagsIdx]) };
          } catch {
            return {};
          }
        })()
        : {})
    });

    if (deckIdIdx >= 0) {
      const deckId = row[deckIdIdx] ?? '';
      if (!deckId) continue;
      const norm = normalizeHeadword(headword);
      if (!norm) continue;
      const existing = decksMap.get(deckId) ?? {
        deckId,
        title: row[deckTitleIdx] || deckId,
        description: deckDescriptionIdx >= 0 ? row[deckDescriptionIdx] || '' : '',
        source: deckSourceIdx >= 0 ? row[deckSourceIdx] || 'csv' : 'csv',
        headwordNorms: []
      };
      if (!existing.headwordNorms.includes(norm)) {
        existing.headwordNorms.push(norm);
      }
      decksMap.set(deckId, existing);
    }
  }

  return {
    words,
    decks: [...decksMap.values()]
  };
};

const resolveUserRole = async (env: Env, userId: string, request: Request) => {
  if (requireAdmin(request, env)) return 'maintainer';
  const result = await dbAll<{ role: string }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT role
         FROM user_roles
         WHERE user_id = ?1
         ORDER BY granted_at DESC
         LIMIT 1`
      ),
      userId
    )
  );
  const role = result.results?.[0]?.role;
  if (!role) return 'contributor';
  return role;
};

const ensureUserProfile = async (env: Env, userId: string) => {
  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO user_profiles (user_id, display_name, created_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(user_id) DO NOTHING`
      ),
      userId,
      `user-${userId.slice(0, 6)}`,
      Date.now()
    )
  );
};

const handleBootstrap = async (env: Env) => {
  const session = await createUserWithApiKey(env, {
    email: null,
    emailVerifiedAt: null
  });
  return jsonResponse({ ok: true, ...session });
};

const handleRequestMagicLink = async (request: Request, env: Env) => {
  let body: MagicLinkRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  const email = sanitizeSingleLine(body.email ?? '').toLowerCase();
  if (!email || !isValidEmail(email)) {
    return badRequest('Valid email is required.');
  }

  const token = await issueMagicLinkToken(env, { email, purpose: 'signin' });
  const appUrl = env.APP_URL?.trim() || 'http://localhost:5173';
  const magicLink = `${appUrl}/auth/verify?token=${encodeURIComponent(token)}`;

  const response: Record<string, unknown> = {
    ok: true,
    message: 'マジックリンクを送信しました。'
  };

  if (shouldExposeDevMagicLink(env)) {
    response._dev = { magicLink };
  }

  return jsonResponse(response);
};

const handleVerifyMagicLink = async (request: Request, env: Env) => {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return badRequest('Token is required.');

  const tokenRow = await consumeMagicLinkToken(env, token);
  if (!tokenRow) {
    return jsonResponse({ ok: false, message: 'Invalid or expired token.' }, { status: 401 });
  }

  const now = Date.now();

  if (tokenRow.purpose === 'link') {
    if (!tokenRow.target_user_id) {
      return jsonResponse({ ok: false, message: 'Invalid link token.' }, { status: 401 });
    }

    const duplicate = await dbAll<{ user_id: string }>(
      dbBind(
        dbPrepare(
          env.DB,
          `SELECT user_id
           FROM users
           WHERE email = ?1 AND user_id != ?2
           LIMIT 1`
        ),
        tokenRow.email,
        tokenRow.target_user_id
      )
    );
    if (duplicate.results?.[0]) {
      return badRequest('このメールアドレスは既に使用されています。');
    }

    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `UPDATE users
           SET email = ?1,
               email_verified_at = ?2
           WHERE user_id = ?3`
        ),
        tokenRow.email,
        now,
        tokenRow.target_user_id
      )
    );

    const userResult = await dbAll<{ avatar_seed: string }>(
      dbBind(
        dbPrepare(env.DB, 'SELECT avatar_seed FROM users WHERE user_id = ?1'),
        tokenRow.target_user_id
      )
    );

    const avatarSeed = userResult.results?.[0]?.avatar_seed ?? randomToken(8);
    const apiKey = await rotateApiKey(env, tokenRow.target_user_id);

    return jsonResponse({
      ok: true,
      userId: tokenRow.target_user_id,
      apiKey,
      avatarSeed,
      email: tokenRow.email,
      isNewUser: false,
      mode: 'linked'
    });
  }

  const existingUser = await dbAll<{ user_id: string; avatar_seed: string }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT user_id, avatar_seed
         FROM users
         WHERE email = ?1
         LIMIT 1`
      ),
      tokenRow.email
    )
  );

  let userId: string;
  let avatarSeed: string;
  let isNewUser = false;
  let apiKey: string;

  if (existingUser.results?.[0]) {
    userId = existingUser.results[0].user_id;
    avatarSeed = existingUser.results[0].avatar_seed;
    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `UPDATE users
           SET email_verified_at = COALESCE(email_verified_at, ?1)
           WHERE user_id = ?2`
        ),
        now,
        userId
      )
    );
    apiKey = await rotateApiKey(env, userId);
  } else {
    const session = await createUserWithApiKey(env, {
      email: tokenRow.email,
      emailVerifiedAt: now
    });
    userId = session.userId;
    avatarSeed = session.avatarSeed;
    apiKey = session.apiKey;
    isNewUser = true;
  }

  await ensureUserProfile(env, userId);

  return jsonResponse({
    ok: true,
    userId,
    apiKey,
    avatarSeed,
    email: tokenRow.email,
    isNewUser,
    mode: 'signin'
  });
};

const handleAuthMe = async (env: Env, auth: AuthContext) => {
  const userResult = await dbAll<{
    user_id: string;
    email: string | null;
    avatar_seed: string;
    created_at: number;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT user_id, email, avatar_seed, created_at
         FROM users
         WHERE user_id = ?1`
      ),
      auth.userId
    )
  );
  const user = userResult.results?.[0];
  if (!user) {
    return jsonResponse({ ok: false, message: 'User not found.' }, { status: 404 });
  }

  await ensureUserProfile(env, auth.userId);

  const progressResult = await dbAll<{ xp_total: number; level: number; streak_days: number }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT xp_total, level, streak_days
         FROM user_progress
         WHERE user_id = ?1`
      ),
      auth.userId
    )
  );

  const progress = progressResult.results?.[0] ?? { xp_total: 0, level: 1, streak_days: 0 };

  return jsonResponse({
    ok: true,
    user: {
      userId: user.user_id,
      email: user.email,
      avatarSeed: user.avatar_seed,
      createdAt: user.created_at,
      xpTotal: progress.xp_total,
      level: progress.level,
      streakDays: progress.streak_days
    }
  });
};

const handleLinkAccount = async (request: Request, env: Env, auth: AuthContext) => {
  let body: LinkAccountRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  const email = sanitizeSingleLine(body.email ?? '').toLowerCase();
  if (!email || !isValidEmail(email)) {
    return badRequest('Valid email is required.');
  }

  const duplicate = await dbAll<{ user_id: string }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT user_id
         FROM users
         WHERE email = ?1 AND user_id != ?2
         LIMIT 1`
      ),
      email,
      auth.userId
    )
  );
  if (duplicate.results?.[0]) {
    return badRequest('このメールアドレスは既に使用されています。');
  }

  const token = await issueMagicLinkToken(env, {
    email,
    purpose: 'link',
    targetUserId: auth.userId
  });
  const appUrl = env.APP_URL?.trim() || 'http://localhost:5173';
  const magicLink = `${appUrl}/auth/verify?token=${encodeURIComponent(token)}`;

  const response: Record<string, unknown> = {
    ok: true,
    message: '確認メールを送信しました。'
  };
  if (shouldExposeDevMagicLink(env)) {
    response._dev = { magicLink };
  }

  return jsonResponse(response);
};

type SyncDeckInput = {
  id: string;
  name: string;
  cards: Array<{
    id: string;
    term: string;
    meaning: string;
    updatedAt: number;
  }>;
  updatedAt: number;
};

type SyncPushRequest = {
  decks: SyncDeckInput[];
  progress?: {
    xpTotal: number;
    level: number;
    streakDays: number;
  };
  lastSyncAt?: number;
};

type SyncPullRequest = {
  lastSyncAt?: number;
};

type SyncProgressRequest = {
  xpTotal: number;
  level: number;
  streakDays: number;
};

const assertDeckOwnership = async (env: Env, auth: AuthContext, deckId: string) => {
  const row = await dbAll<{ user_id: string }>(
    dbBind(dbPrepare(env.DB, 'SELECT user_id FROM user_decks WHERE id = ?1'), deckId)
  );
  const owner = row.results?.[0]?.user_id;
  if (owner && owner !== auth.userId) {
    throw new HttpError(403, 'Deck ownership conflict.');
  }
};

const assertCardOwnership = async (env: Env, auth: AuthContext, cardId: string) => {
  const row = await dbAll<{ user_id: string }>(
    dbBind(dbPrepare(env.DB, 'SELECT user_id FROM user_cards WHERE id = ?1'), cardId)
  );
  const owner = row.results?.[0]?.user_id;
  if (owner && owner !== auth.userId) {
    throw new HttpError(403, 'Card ownership conflict.');
  }
};

const handleSyncPush = async (request: Request, env: Env, auth: AuthContext) => {
  let body: SyncPushRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  const now = Date.now();
  const decks = Array.isArray(body.decks) ? body.decks.slice(0, 100) : [];

  try {
    for (const deck of decks) {
      if (!deck?.id || typeof deck.id !== 'string') continue;
      if (typeof deck.name !== 'string' || !deck.name.trim()) continue;
      await assertDeckOwnership(env, auth, deck.id);

      await dbRun(
        dbBind(
          dbPrepare(
            env.DB,
            `INSERT INTO user_decks (id, user_id, title, created_at, updated_at, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
               title = excluded.title,
               updated_at = MAX(user_decks.updated_at, excluded.updated_at),
               synced_at = excluded.synced_at
             WHERE user_decks.user_id = excluded.user_id`
          ),
          deck.id,
          auth.userId,
          sanitizeSingleLine(deck.name).slice(0, 80),
          deck.updatedAt || now,
          deck.updatedAt || now,
          now
        )
      );

      for (const card of (deck.cards || []).slice(0, 500)) {
        if (!card?.id || typeof card.id !== 'string') continue;
        if (typeof card.term !== 'string' || typeof card.meaning !== 'string') continue;

        await assertCardOwnership(env, auth, card.id);

        const headword = sanitizeSingleLine(card.term).slice(0, 64);
        const headwordNorm = normalizeHeadword(headword);
        if (!headwordNorm) continue;

        const meaning = sanitizeSingleLine(card.meaning).slice(0, LIMITS.meaningMax);
        if (!meaning) continue;

        await dbRun(
          dbBind(
            dbPrepare(
              env.DB,
              `INSERT INTO user_cards (id, deck_id, user_id, headword_norm, headword, meaning_ja, due_at, created_at, updated_at, synced_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
               ON CONFLICT(id) DO UPDATE SET
                 deck_id = excluded.deck_id,
                 headword_norm = excluded.headword_norm,
                 headword = excluded.headword,
                 meaning_ja = excluded.meaning_ja,
                 updated_at = MAX(user_cards.updated_at, excluded.updated_at),
                 synced_at = excluded.synced_at
               WHERE user_cards.user_id = excluded.user_id`
            ),
            card.id,
            deck.id,
            auth.userId,
            headwordNorm,
            headword,
            meaning,
            now,
            card.updatedAt || now,
            card.updatedAt || now,
            now
          )
        );
      }
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }

  if (body.progress) {
    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO user_progress (user_id, xp_total, level, streak_days, synced_at)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(user_id) DO UPDATE SET
             xp_total = MAX(user_progress.xp_total, excluded.xp_total),
             level = MAX(user_progress.level, excluded.level),
             streak_days = MAX(user_progress.streak_days, excluded.streak_days),
             synced_at = excluded.synced_at`
        ),
        auth.userId,
        Math.max(0, Number(body.progress.xpTotal ?? 0)),
        Math.max(1, Number(body.progress.level ?? 1)),
        Math.max(0, Number(body.progress.streakDays ?? 0)),
        now
      )
    );
  }

  return jsonResponse({
    ok: true,
    syncedAt: now,
    deckCount: decks.length
  });
};

const handleSyncPull = async (request: Request, env: Env, auth: AuthContext) => {
  let body: SyncPullRequest;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const lastSyncAt = Number(body.lastSyncAt ?? 0);

  const decksResult = await dbAll<{
    id: string;
    title: string;
    updated_at: number;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT id, title, updated_at
         FROM user_decks
         WHERE user_id = ?1
           AND deleted_at IS NULL
           AND updated_at > ?2
         ORDER BY updated_at DESC`
      ),
      auth.userId,
      lastSyncAt
    )
  );

  const decks = [] as Array<{
    id: string;
    name: string;
    updatedAt: number;
    cards: Array<{ id: string; term: string; meaning: string; updatedAt: number }>;
  }>;

  for (const deck of decksResult.results ?? []) {
    const cardsResult = await dbAll<{
      id: string;
      headword: string;
      meaning_ja: string;
      updated_at: number;
    }>(
      dbBind(
        dbPrepare(
          env.DB,
          `SELECT id, headword, meaning_ja, updated_at
           FROM user_cards
           WHERE user_id = ?1
             AND deck_id = ?2
             AND deleted_at IS NULL
             AND updated_at > ?3
           ORDER BY updated_at DESC`
        ),
        auth.userId,
        deck.id,
        lastSyncAt
      )
    );

    decks.push({
      id: deck.id,
      name: deck.title,
      updatedAt: deck.updated_at,
      cards: (cardsResult.results ?? []).map((card) => ({
        id: card.id,
        term: card.headword,
        meaning: card.meaning_ja,
        updatedAt: card.updated_at
      }))
    });
  }

  const progressResult = await dbAll<{
    xp_total: number;
    level: number;
    streak_days: number;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT xp_total, level, streak_days
         FROM user_progress
         WHERE user_id = ?1`
      ),
      auth.userId
    )
  );

  const progress = progressResult.results?.[0] ?? { xp_total: 0, level: 1, streak_days: 0 };

  return jsonResponse({
    ok: true,
    decks,
    progress: {
      xpTotal: progress.xp_total,
      level: progress.level,
      streakDays: progress.streak_days
    },
    serverTime: Date.now()
  });
};

const handleSyncProgress = async (request: Request, env: Env, auth: AuthContext) => {
  let body: SyncProgressRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  const now = Date.now();
  const xpTotal = Math.max(0, Number(body.xpTotal ?? 0));
  const level = Math.max(1, Number(body.level ?? 1));
  const streakDays = Math.max(0, Number(body.streakDays ?? 0));

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO user_progress (user_id, xp_total, level, streak_days, synced_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id) DO UPDATE SET
           xp_total = MAX(user_progress.xp_total, excluded.xp_total),
           level = MAX(user_progress.level, excluded.level),
           streak_days = MAX(user_progress.streak_days, excluded.streak_days),
           synced_at = excluded.synced_at`
      ),
      auth.userId,
      xpTotal,
      level,
      streakDays,
      now
    )
  );

  const result = await dbAll<{ xp_total: number; level: number; streak_days: number }>(
    dbBind(
      dbPrepare(env.DB, 'SELECT xp_total, level, streak_days FROM user_progress WHERE user_id = ?1'),
      auth.userId
    )
  );

  const progress = result.results?.[0] ?? { xp_total: 0, level: 1, streak_days: 0 };

  return jsonResponse({
    ok: true,
    progress: {
      xpTotal: progress.xp_total,
      level: progress.level,
      streakDays: progress.streak_days
    },
    syncedAt: now
  });
};

const handleUsageReport = async (request: Request, env: Env, auth: AuthContext) => {
  let body: UsageReportRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  const minutesToday = Math.max(0, Math.min(LIMITS.usageMinutesMax, Math.floor(Number(body.minutesToday ?? 0))));
  const dateKey = getUsageDateKey();
  await ensureUsageRow(env, auth.userId, dateKey);

  const base = 1;
  const maxTokens = parsePositiveInt(env.PROOFREAD_TOKEN_MAX, LIMITS.maxProofreadTokens);
  const tokens = Math.min(maxTokens, Math.floor(minutesToday / 5) + base);

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `UPDATE usage_daily
         SET minutes_today = ?3,
             proofread_tokens_today = ?4,
             updated_at = ?5
         WHERE user_id = ?1
           AND usage_date = ?2`
      ),
      auth.userId,
      dateKey,
      minutesToday,
      tokens,
      Date.now()
    )
  );

  const usage = await getUsageSnapshot(env, auth.userId);
  return jsonResponse({ ok: true, usage });
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

  const foundMap = new Map<
    string,
    {
      source: 'community' | 'core' | 'legacy';
      headword: string;
      meaningJa: string;
      exampleEn?: string;
      note?: string;
      lexemeId?: number;
    }
  >();

  const normPlaceholders = norms.map((_, idx) => `?${idx + 1}`).join(',');

  // 1) community canonical
  const canonicalRows = await dbAll<{
    headword_norm: string;
    meaning_ja_short: string;
    example_en_short: string | null;
    note_short: string | null;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT headword_norm, meaning_ja_short, example_en_short, note_short
         FROM ugc_lexeme_canonical
         WHERE headword_norm IN (${normPlaceholders})`
      ),
      ...norms
    )
  );

  for (const row of canonicalRows.results ?? []) {
    foundMap.set(row.headword_norm, {
      source: 'community',
      headword: uniqueMap.get(row.headword_norm) ?? row.headword_norm,
      meaningJa: row.meaning_ja_short,
      ...(row.example_en_short ? { exampleEn: row.example_en_short } : {}),
      ...(row.note_short ? { note: row.note_short } : {})
    });
  }

  const remainingAfterCanonical = norms.filter((norm) => !foundMap.has(norm));

  // 2) core words
  if (remainingAfterCanonical.length > 0) {
    const placeholders = remainingAfterCanonical.map((_, idx) => `?${idx + 1}`).join(',');
    const coreRows = await dbAll<{
      headword_norm: string;
      headword: string;
      meaning_ja_short: string;
    }>(
      dbBind(
        dbPrepare(
          env.DB,
          `SELECT headword_norm, headword, meaning_ja_short
           FROM core_words
           WHERE headword_norm IN (${placeholders})`
        ),
        ...remainingAfterCanonical
      )
    );

    for (const row of coreRows.results ?? []) {
      foundMap.set(row.headword_norm, {
        source: 'core',
        headword: row.headword,
        meaningJa: row.meaning_ja_short
      });
    }
  }

  const remainingAfterCore = norms.filter((norm) => !foundMap.has(norm));

  // 3) legacy lexemes
  if (remainingAfterCore.length > 0) {
    const placeholders = remainingAfterCore.map((_, idx) => `?${idx + 1}`).join(',');
    const lexemeResult = await dbAll<{
      lexeme_id: number;
      headword: string;
      headword_norm: string;
    }>(
      dbBind(
        dbPrepare(
          env.DB,
          `SELECT lexeme_id, headword, headword_norm
           FROM lexemes
           WHERE headword_norm IN (${placeholders})`
        ),
        ...remainingAfterCore
      )
    );

    const lexemes = lexemeResult.results ?? [];
    if (lexemes.length > 0) {
      const lexemeIds = lexemes.map((lexeme) => lexeme.lexeme_id);
      const entryPlaceholders = lexemeIds.map((_, idx) => `?${idx + 1}`).join(',');
      const entriesResult = await dbAll<{
        lexeme_id: number;
        meaning_ja: string | null;
        example_en: string | null;
        note: string | null;
      }>(
        dbBind(
          dbPrepare(
            env.DB,
            `SELECT lexeme_id, meaning_ja, example_en, note
             FROM (
               SELECT lexeme_id, meaning_ja, example_en, note, created_at,
                 ROW_NUMBER() OVER (PARTITION BY lexeme_id ORDER BY created_at DESC) AS rn
               FROM lexeme_entries
               WHERE lexeme_id IN (${entryPlaceholders}) AND scope_type = 'public'
             )
             WHERE rn = 1`
          ),
          ...lexemeIds
        )
      );

      const entriesByLexeme = new Map<number, { meaning_ja: string | null; example_en: string | null; note: string | null }>();
      for (const entry of entriesResult.results ?? []) {
        entriesByLexeme.set(entry.lexeme_id, entry);
      }

      for (const lexeme of lexemes) {
        const entry = entriesByLexeme.get(lexeme.lexeme_id);
        foundMap.set(lexeme.headword_norm, {
          source: 'legacy',
          headword: lexeme.headword,
          meaningJa: entry?.meaning_ja ?? '',
          ...(entry?.example_en ? { exampleEn: entry.example_en } : {}),
          ...(entry?.note ? { note: entry.note } : {}),
          lexemeId: lexeme.lexeme_id
        });
      }
    }
  }

  const found = norms
    .filter((norm) => foundMap.has(norm))
    .map((norm) => {
      const item = foundMap.get(norm)!;
      return {
        lexemeId: item.lexemeId ?? 0,
        headword: item.headword,
        headwordNorm: norm,
        source: item.source,
        entries: [
          {
            meaning_ja: item.meaningJa,
            ...(item.exampleEn ? { example_en: item.exampleEn } : {}),
            ...(item.note ? { note: item.note } : {})
          }
        ]
      };
    });

  const missing = norms
    .filter((norm) => !foundMap.has(norm))
    .map((norm) => uniqueMap.get(norm) ?? norm);

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
    const headword = sanitizeSingleLine(entry.headword).slice(0, 64);
    const headwordNorm = normalizeHeadword(headword);
    if (!headwordNorm) {
      errors.push({ index, message: 'headword is invalid.' });
      return;
    }
    if (typeof entry.meaningJa !== 'string' || !entry.meaningJa.trim()) {
      errors.push({ index, message: 'meaningJa is required.' });
      return;
    }
    const meaningJa = sanitizeSingleLine(entry.meaningJa);
    const meaningError = validateShortText(meaningJa, LIMITS.meaningMax);
    if (meaningError) {
      errors.push({ index, message: `meaningJa: ${meaningError}` });
      return;
    }
    const exampleEn = sanitizeSingleLine(entry.exampleEn ?? '');
    if (exampleEn) {
      const exampleError = validateShortText(exampleEn, LIMITS.exampleMax);
      if (exampleError) {
        errors.push({ index, message: `exampleEn: ${exampleError}` });
        return;
      }
    }
    const note = sanitizeSingleLine(entry.note ?? '');
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
  const message = sanitizeSingleLine(body.message);
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

const handleWordbankDecks = async (env: Env) => {
  const result = await dbAll<{
    deck_id: string;
    title: string;
    description: string | null;
    source: string | null;
    created_at: number;
    word_count: number;
  }>(
    dbPrepare(
      env.DB,
      `SELECT
         d.deck_id,
         d.title,
         d.description,
         d.source,
         d.created_at,
         COUNT(dw.word_id) AS word_count
       FROM core_decks d
       LEFT JOIN core_deck_words dw ON dw.deck_id = d.deck_id
       GROUP BY d.deck_id, d.title, d.description, d.source, d.created_at
       ORDER BY d.created_at DESC, d.title`
    )
  );

  return jsonResponse({
    ok: true,
    decks: (result.results ?? []).map((row) => ({
      deckId: row.deck_id,
      title: row.title,
      description: row.description ?? '',
      source: row.source ?? 'core',
      wordCount: Number(row.word_count ?? 0),
      createdAt: row.created_at
    }))
  });
};

const handleWordbankDeckWords = async (env: Env, deckId: string) => {
  const result = await dbAll<{
    deck_id: string;
    title: string;
    description: string | null;
    source: string | null;
    order_index: number;
    word_id: string;
    headword: string;
    headword_norm: string;
    meaning_ja_short: string;
    pos: string | null;
    level: string | null;
    tags_json: string | null;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT
           d.deck_id,
           d.title,
           d.description,
           d.source,
           dw.order_index,
           w.word_id,
           w.headword,
           w.headword_norm,
           w.meaning_ja_short,
           w.pos,
           w.level,
           w.tags_json
         FROM core_decks d
         JOIN core_deck_words dw ON dw.deck_id = d.deck_id
         JOIN core_words w ON w.word_id = dw.word_id
         WHERE d.deck_id = ?1
         ORDER BY dw.order_index ASC, w.headword ASC`
      ),
      deckId
    )
  );

  const rows = result.results ?? [];
  if (rows.length === 0) {
    return jsonResponse({ ok: false, message: 'Deck not found.' }, { status: 404 });
  }

  return jsonResponse({
    ok: true,
    deck: {
      deckId: rows[0].deck_id,
      title: rows[0].title,
      description: rows[0].description ?? '',
      source: rows[0].source ?? 'core'
    },
    words: rows.map((row) => ({
      wordId: row.word_id,
      headword: row.headword,
      headwordNorm: row.headword_norm,
      meaningJaShort: row.meaning_ja_short,
      pos: row.pos,
      level: row.level,
      tagsJson: (() => {
        if (!row.tags_json) return null;
        try {
          return JSON.parse(row.tags_json);
        } catch {
          return null;
        }
      })(),
      orderIndex: row.order_index
    }))
  });
};

const handleWordbankAdminUpsert = async (request: Request, env: Env) => {
  if (!requireAdmin(request, env)) {
    return forbidden('Admin token is required.');
  }

  let body: WordbankAdminUpsertRequest;
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  try {
    if (contentType.includes('text/csv')) {
      const text = await request.text();
      body = parseWordbankCsvPayload(text);
    } else {
      body = await request.json();
    }
  } catch (error) {
    if (error instanceof HttpError) {
      return badRequest(error.message);
    }
    return badRequest('Invalid payload.');
  }

  const now = Date.now();
  const words = body.words ?? [];
  const decks = body.decks ?? [];

  for (const rawWord of words) {
    if (!rawWord || typeof rawWord.headword !== 'string' || typeof rawWord.meaningJaShort !== 'string') {
      return badRequest('Invalid word payload.');
    }

    const headword = sanitizeSingleLine(rawWord.headword).slice(0, 64);
    const headwordNorm = normalizeHeadword(headword);
    if (!headwordNorm) {
      return badRequest(`Invalid headword: ${rawWord.headword}`);
    }

    const meaning = sanitizeSingleLine(rawWord.meaningJaShort);
    const meaningError = validateShortText(meaning, LIMITS.meaningMax);
    if (meaningError) {
      return badRequest(`meaningJaShort: ${meaningError}`);
    }

    const pos = sanitizeSingleLine(rawWord.pos ?? '').slice(0, 32);
    const level = sanitizeSingleLine(rawWord.level ?? '').slice(0, 32);
    const source = sanitizeSingleLine(rawWord.source ?? 'manual').slice(0, 40);
    const tagsJson = rawWord.tagsJson == null ? null : JSON.stringify(rawWord.tagsJson).slice(0, 500);

    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO core_words
             (word_id, headword, headword_norm, meaning_ja_short, pos, level, tags_json, source, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), NULLIF(?6, ''), ?7, NULLIF(?8, ''), ?9, ?9)
           ON CONFLICT(headword_norm) DO UPDATE SET
             headword = excluded.headword,
             meaning_ja_short = excluded.meaning_ja_short,
             pos = excluded.pos,
             level = excluded.level,
             tags_json = excluded.tags_json,
             source = excluded.source,
             updated_at = excluded.updated_at`
        ),
        crypto.randomUUID(),
        headword,
        headwordNorm,
        meaning,
        pos,
        level,
        tagsJson,
        source,
        now
      )
    );
  }

  for (const deck of decks) {
    if (!deck?.deckId || typeof deck.deckId !== 'string' || typeof deck.title !== 'string') {
      return badRequest('Invalid deck payload.');
    }

    const deckId = sanitizeSingleLine(deck.deckId).slice(0, 64);
    const title = sanitizeSingleLine(deck.title).slice(0, 80);
    const description = sanitizeSingleLine(deck.description ?? '').slice(0, 200);
    const source = sanitizeSingleLine(deck.source ?? 'manual').slice(0, 40);

    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO core_decks (deck_id, title, description, source, created_at)
           VALUES (?1, ?2, NULLIF(?3, ''), NULLIF(?4, ''), ?5)
           ON CONFLICT(deck_id) DO UPDATE SET
             title = excluded.title,
             description = excluded.description,
             source = excluded.source`
        ),
        deckId,
        title,
        description,
        source,
        now
      )
    );

    if (Array.isArray(deck.headwordNorms)) {
      await dbRun(
        dbBind(dbPrepare(env.DB, 'DELETE FROM core_deck_words WHERE deck_id = ?1'), deckId)
      );

      let order = 0;
      for (const rawNorm of deck.headwordNorms) {
        if (typeof rawNorm !== 'string') continue;
        const norm = normalizeHeadword(rawNorm);
        if (!norm) continue;

        const wordRow = await dbAll<{ word_id: string }>(
          dbBind(
            dbPrepare(env.DB, 'SELECT word_id FROM core_words WHERE headword_norm = ?1 LIMIT 1'),
            norm
          )
        );
        const wordId = wordRow.results?.[0]?.word_id;
        if (!wordId) continue;

        await dbRun(
          dbBind(
            dbPrepare(
              env.DB,
              `INSERT INTO core_deck_words (deck_id, word_id, order_index)
               VALUES (?1, ?2, ?3)`
            ),
            deckId,
            wordId,
            order
          )
        );
        order += 1;
      }
    }
  }

  return jsonResponse({ ok: true, upsertedWords: words.length, upsertedDecks: decks.length });
};

const ensureDailyDungeon = async (env: Env) => {
  const dateKey = getUsageDateKey();
  const dungeonId = `daily-${dateKey}`;

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO game_dungeons_daily (date, dungeon_id, title, description)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(date) DO NOTHING`
      ),
      dateKey,
      dungeonId,
      '今日の冒険',
      '校正タスクをこなして単語デッキを解放しよう'
    )
  );

  const taskCount = await dbAll<{ count: number }>(
    dbBind(
      dbPrepare(
        env.DB,
        'SELECT COUNT(*) AS count FROM game_dungeon_tasks WHERE dungeon_id = ?1'
      ),
      dungeonId
    )
  );

  if ((taskCount.results?.[0]?.count ?? 0) > 0) {
    return dungeonId;
  }

  const words = await dbAll<{ headword_norm: string }>(
    dbPrepare(
      env.DB,
      `SELECT headword_norm
       FROM core_words
       ORDER BY updated_at DESC, headword ASC
       LIMIT 5`
    )
  );

  let i = 0;
  for (const row of words.results ?? []) {
    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO game_dungeon_tasks (dungeon_id, task_id, type, headword_norm, status, assigned_to)
           VALUES (?1, ?2, 'proofread', ?3, 'pending', NULL)`
        ),
        dungeonId,
        crypto.randomUUID(),
        row.headword_norm
      )
    );
    i += 1;
  }

  if (i === 0) {
    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO game_dungeon_tasks (dungeon_id, task_id, type, headword_norm, status, assigned_to)
           VALUES (?1, ?2, 'propose', ?3, 'pending', NULL)`
        ),
        dungeonId,
        crypto.randomUUID(),
        'start'
      )
    );
  }

  return dungeonId;
};

const handleCommunityCreateChangeset = async (request: Request, env: Env, auth: AuthContext) => {
  let body: CreateChangesetRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  const title = sanitizeSingleLine(body.title ?? '').slice(0, 80);
  if (!title) return badRequest('title is required.');

  const description = sanitizeSingleLine(body.description ?? '').slice(0, 200);
  const changesetId = crypto.randomUUID();
  const now = Date.now();

  await ensureUserProfile(env, auth.userId);

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO ugc_changesets
           (changeset_id, title, description, created_by, status, created_at, updated_at)
         VALUES (?1, ?2, NULLIF(?3, ''), ?4, 'draft', ?5, ?5)`
      ),
      changesetId,
      title,
      description,
      auth.userId,
      now
    )
  );

  return jsonResponse({ ok: true, changesetId });
};

const handleCommunityAddItems = async (
  request: Request,
  env: Env,
  auth: AuthContext,
  changesetId: string
) => {
  let body: AddChangesetItemsRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return badRequest('items must be a non-empty array.');
  }
  if (body.items.length > LIMITS.changesetItemsMax) {
    return badRequest(`items must be ${LIMITS.changesetItemsMax} or fewer.`);
  }

  const ownerRow = await dbAll<{ created_by: string; status: string }>(
    dbBind(
      dbPrepare(
        env.DB,
        'SELECT created_by, status FROM ugc_changesets WHERE changeset_id = ?1'
      ),
      changesetId
    )
  );
  const changeset = ownerRow.results?.[0];
  if (!changeset) {
    return jsonResponse({ ok: false, message: 'Changeset not found.' }, { status: 404 });
  }
  if (changeset.created_by !== auth.userId) {
    return forbidden();
  }
  if (changeset.status !== 'draft' && changeset.status !== 'proposed') {
    return badRequest('Cannot modify this changeset state.');
  }

  let inserted = 0;
  for (const item of body.items) {
    const headwordNorm = normalizeHeadword(item.headword ?? '');
    if (!headwordNorm) continue;

    const fields = validateMeaningFields({
      meaningJaShort: item.meaningJaShort,
      exampleEnShort: item.exampleEnShort,
      noteShort: item.noteShort
    });
    if (!fields.ok) return badRequest(fields.message);

    const patch = {
      meaningJaShort: fields.value.meaningJaShort,
      exampleEnShort: fields.value.exampleEnShort,
      noteShort: fields.value.noteShort
    };

    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO ugc_changeset_items
             (item_id, changeset_id, headword_norm, patch_json, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5)`
        ),
        crypto.randomUUID(),
        changesetId,
        headwordNorm,
        JSON.stringify(patch),
        Date.now()
      )
    );
    inserted += 1;
  }

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        'UPDATE ugc_changesets SET updated_at = ?2 WHERE changeset_id = ?1'
      ),
      changesetId,
      Date.now()
    )
  );

  return jsonResponse({ ok: true, inserted });
};

const handleCommunitySubmit = async (
  env: Env,
  auth: AuthContext,
  changesetId: string,
  body: SubmitChangesetRequest
) => {
  const row = await dbAll<{ created_by: string; status: string }>(
    dbBind(
      dbPrepare(env.DB, 'SELECT created_by, status FROM ugc_changesets WHERE changeset_id = ?1'),
      changesetId
    )
  );
  const changeset = row.results?.[0];
  if (!changeset) {
    return jsonResponse({ ok: false, message: 'Changeset not found.' }, { status: 404 });
  }
  if (changeset.created_by !== auth.userId) {
    return forbidden();
  }
  if (changeset.status !== 'draft' && changeset.status !== 'proposed') {
    return badRequest('Cannot submit this changeset state.');
  }

  const itemCount = await dbAll<{ count: number }>(
    dbBind(
      dbPrepare(
        env.DB,
        'SELECT COUNT(*) AS count FROM ugc_changeset_items WHERE changeset_id = ?1'
      ),
      changesetId
    )
  );
  if ((itemCount.results?.[0]?.count ?? 0) < 1) {
    return badRequest('Add at least one item before submit.');
  }

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `UPDATE ugc_changesets
         SET status = 'proposed',
             updated_at = ?2
         WHERE changeset_id = ?1`
      ),
      changesetId,
      Date.now()
    )
  );

  const note = sanitizeSingleLine(body.note ?? '').slice(0, 120);
  if (note) {
    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO ugc_reviews
             (review_id, changeset_id, reviewer_user_id, action, comment, created_at)
           VALUES (?1, ?2, ?3, 'comment', ?4, ?5)`
        ),
        crypto.randomUUID(),
        changesetId,
        auth.userId,
        note,
        Date.now()
      )
    );
  }

  return jsonResponse({ ok: true });
};

const handleCommunityReview = async (
  request: Request,
  env: Env,
  auth: AuthContext,
  changesetId: string
) => {
  let body: ReviewChangesetRequest;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON.');
  }

  if (!['approve', 'request_changes', 'comment'].includes(body.action)) {
    return badRequest('Invalid action.');
  }

  const comment = sanitizeSingleLine(body.comment ?? '').slice(0, LIMITS.feedbackMessageMax);
  const commentError = comment ? validateShortText(comment, LIMITS.feedbackMessageMax) : null;
  if (commentError) return badRequest(commentError);

  const role = await resolveUserRole(env, auth.userId, request);
  if (body.action !== 'comment' && role === 'contributor') {
    return forbidden('You need proofreader role for this action.');
  }

  const targetRow = await dbAll<{ status: string }>(
    dbBind(
      dbPrepare(env.DB, 'SELECT status FROM ugc_changesets WHERE changeset_id = ?1'),
      changesetId
    )
  );
  const targetStatus = targetRow.results?.[0]?.status;
  if (!targetStatus) {
    return jsonResponse({ ok: false, message: 'Changeset not found.' }, { status: 404 });
  }
  if (targetStatus === 'merged' || targetStatus === 'closed') {
    return badRequest('This changeset is already finalized.');
  }

  if (body.action === 'approve') {
    const allowed = await consumeProofreadToken(env, auth.userId);
    if (!allowed) {
      return tooManyRequests('今日の校正トークンを使い切りました。明日また挑戦してね。');
    }
  }

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO ugc_reviews
           (review_id, changeset_id, reviewer_user_id, action, comment, created_at)
         VALUES (?1, ?2, ?3, ?4, NULLIF(?5, ''), ?6)`
      ),
      crypto.randomUUID(),
      changesetId,
      auth.userId,
      body.action,
      comment,
      Date.now()
    )
  );

  if (body.action === 'approve') {
    const approvals = await dbAll<{ count: number }>(
      dbBind(
        dbPrepare(
          env.DB,
          `SELECT COUNT(*) AS count
           FROM ugc_reviews
           WHERE changeset_id = ?1
             AND action = 'approve'`
        ),
        changesetId
      )
    );
    if ((approvals.results?.[0]?.count ?? 0) >= 2) {
      await dbRun(
        dbBind(
          dbPrepare(
            env.DB,
            `UPDATE ugc_changesets
             SET status = 'approved',
                 updated_at = ?2
             WHERE changeset_id = ?1
               AND status IN ('draft', 'proposed')`
          ),
          changesetId,
          Date.now()
        )
      );
    }
  } else if (body.action === 'request_changes') {
    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `UPDATE ugc_changesets
           SET status = 'draft',
               updated_at = ?2
           WHERE changeset_id = ?1`
        ),
        changesetId,
        Date.now()
      )
    );
  }

  return jsonResponse({ ok: true });
};

const handleCommunityMerge = async (
  request: Request,
  env: Env,
  auth: AuthContext,
  changesetId: string
) => {
  let body: MergeChangesetRequest = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const role = await resolveUserRole(env, auth.userId, request);
  if (!['editor', 'maintainer'].includes(role)) {
    return forbidden('editor role is required to merge.');
  }

  const changesetRow = await dbAll<{ status: string }>(
    dbBind(
      dbPrepare(env.DB, 'SELECT status FROM ugc_changesets WHERE changeset_id = ?1'),
      changesetId
    )
  );
  const status = changesetRow.results?.[0]?.status;
  if (!status) {
    return jsonResponse({ ok: false, message: 'Changeset not found.' }, { status: 404 });
  }
  if (!['approved', 'proposed'].includes(status)) {
    return badRequest('Only approved/proposed changeset can be merged.');
  }

  const itemRows = await dbAll<{ headword_norm: string; patch_json: string }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT headword_norm, patch_json
         FROM ugc_changeset_items
         WHERE changeset_id = ?1`
      ),
      changesetId
    )
  );
  if ((itemRows.results?.length ?? 0) === 0) {
    return badRequest('No items to merge.');
  }

  for (const row of itemRows.results ?? []) {
    const patch = JSON.parse(row.patch_json) as {
      meaningJaShort?: string;
      exampleEnShort?: string;
      noteShort?: string;
    };

    const fields = validateMeaningFields({
      meaningJaShort: patch.meaningJaShort,
      exampleEnShort: patch.exampleEnShort,
      noteShort: patch.noteShort
    });
    if (!fields.ok) {
      return badRequest(fields.message);
    }

    const versionResult = await dbAll<{ version_int: number }>(
      dbBind(
        dbPrepare(
          env.DB,
          `SELECT version_int
           FROM ugc_lexeme_canonical
           WHERE headword_norm = ?1`
        ),
        row.headword_norm
      )
    );

    const nextVersion = (versionResult.results?.[0]?.version_int ?? 0) + 1;

    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO ugc_lexeme_canonical
             (headword_norm, meaning_ja_short, example_en_short, note_short, source, version_int, updated_at, updated_by)
           VALUES (?1, ?2, NULLIF(?3, ''), NULLIF(?4, ''), 'community', ?5, ?6, ?7)
           ON CONFLICT(headword_norm) DO UPDATE SET
             meaning_ja_short = excluded.meaning_ja_short,
             example_en_short = excluded.example_en_short,
             note_short = excluded.note_short,
             source = excluded.source,
             version_int = excluded.version_int,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by`
        ),
        row.headword_norm,
        fields.value.meaningJaShort,
        fields.value.exampleEnShort,
        fields.value.noteShort,
        nextVersion,
        Date.now(),
        auth.userId
      )
    );

    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO ugc_lexeme_history
             (headword_norm, version_int, snapshot_json, created_at, created_by, changeset_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
        ),
        row.headword_norm,
        nextVersion,
        JSON.stringify(fields.value),
        Date.now(),
        auth.userId,
        changesetId
      )
    );
  }

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `UPDATE ugc_changesets
         SET status = 'merged',
             merged_at = ?2,
             updated_at = ?2
         WHERE changeset_id = ?1`
      ),
      changesetId,
      Date.now()
    )
  );

  const note = sanitizeSingleLine(body.note ?? '').slice(0, 120);
  if (note) {
    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `INSERT INTO ugc_reviews
             (review_id, changeset_id, reviewer_user_id, action, comment, created_at)
           VALUES (?1, ?2, ?3, 'comment', ?4, ?5)`
        ),
        crypto.randomUUID(),
        changesetId,
        auth.userId,
        note,
        Date.now()
      )
    );
  }

  return jsonResponse({ ok: true });
};

const handleCommunityLexeme = async (env: Env, rawHeadword: string) => {
  const norm = normalizeHeadword(rawHeadword);
  if (!norm) return badRequest('Invalid headword.');

  const row = await dbAll<{
    headword_norm: string;
    meaning_ja_short: string;
    example_en_short: string | null;
    note_short: string | null;
    source: string;
    version_int: number;
    updated_at: number;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT headword_norm, meaning_ja_short, example_en_short, note_short, source, version_int, updated_at
         FROM ugc_lexeme_canonical
         WHERE headword_norm = ?1`
      ),
      norm
    )
  );

  const canonical = row.results?.[0];
  if (canonical) {
    return jsonResponse({
      ok: true,
      lexeme: {
        headwordNorm: canonical.headword_norm,
        meaningJaShort: canonical.meaning_ja_short,
        exampleEnShort: canonical.example_en_short,
        noteShort: canonical.note_short,
        source: canonical.source,
        version: canonical.version_int,
        updatedAt: canonical.updated_at
      }
    });
  }

  const core = await dbAll<{ headword: string; headword_norm: string; meaning_ja_short: string; updated_at: number }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT headword, headword_norm, meaning_ja_short, updated_at
         FROM core_words
         WHERE headword_norm = ?1`
      ),
      norm
    )
  );
  const coreWord = core.results?.[0];
  if (coreWord) {
    return jsonResponse({
      ok: true,
      lexeme: {
        headword: coreWord.headword,
        headwordNorm: coreWord.headword_norm,
        meaningJaShort: coreWord.meaning_ja_short,
        source: 'core',
        updatedAt: coreWord.updated_at
      }
    });
  }

  return jsonResponse({ ok: false, message: 'Lexeme not found.' }, { status: 404 });
};

const handleCommunityTasks = async (env: Env, auth: AuthContext) => {
  const dungeonId = await ensureDailyDungeon(env);
  const usage = await getUsageSnapshot(env, auth.userId);

  const dungeonRow = await dbAll<{ date: string; title: string; description: string | null }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT date, title, description
         FROM game_dungeons_daily
         WHERE dungeon_id = ?1`
      ),
      dungeonId
    )
  );

  const tasks = await dbAll<{
    task_id: string;
    type: string;
    headword_norm: string;
    status: string;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT task_id, type, headword_norm, status
         FROM game_dungeon_tasks
         WHERE dungeon_id = ?1
         ORDER BY created_at ASC`
      ),
      dungeonId
    )
  );

  const progressRow = await dbAll<{ cleared_count: number; reward_claimed: number }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT cleared_count, reward_claimed
         FROM user_dungeon_progress
         WHERE user_id = ?1 AND date = ?2 AND dungeon_id = ?3`
      ),
      auth.userId,
      usage.date,
      dungeonId
    )
  );

  const progress = progressRow.results?.[0] ?? { cleared_count: 0, reward_claimed: 0 };
  const totalTasks = tasks.results?.length ?? 0;
  const unlockReady = totalTasks > 0 && progress.cleared_count >= totalTasks;

  return jsonResponse({
    ok: true,
    dungeon: {
      dungeonId,
      date: usage.date,
      title: dungeonRow.results?.[0]?.title ?? '今日の冒険',
      description: dungeonRow.results?.[0]?.description ?? '',
      totalTasks,
      clearedCount: progress.cleared_count,
      rewardClaimed: Boolean(progress.reward_claimed),
      unlockReady
    },
    usage,
    tasks: (tasks.results ?? []).map((task) => ({
      taskId: task.task_id,
      type: task.type,
      headwordNorm: task.headword_norm,
      status: task.status
    }))
  });
};

const handleCommunityCompleteTask = async (
  env: Env,
  auth: AuthContext,
  taskId: string
) => {
  const usage = await getUsageSnapshot(env, auth.userId);
  if (usage.proofreadRemainingToday <= 0) {
    return tooManyRequests('今日の校正トークンを使い切りました。明日また挑戦してね。');
  }

  const row = await dbAll<{
    task_id: string;
    dungeon_id: string;
    status: string;
    headword_norm: string;
  }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT task_id, dungeon_id, status, headword_norm
         FROM game_dungeon_tasks
         WHERE task_id = ?1`
      ),
      taskId
    )
  );
  const task = row.results?.[0];
  if (!task) {
    return jsonResponse({ ok: false, message: 'Task not found.' }, { status: 404 });
  }

  if (task.status === 'done') {
    return jsonResponse({ ok: true, alreadyDone: true });
  }

  const consumed = await consumeProofreadToken(env, auth.userId);
  if (!consumed) {
    return tooManyRequests('今日の校正トークンを使い切りました。明日また挑戦してね。');
  }

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `UPDATE game_dungeon_tasks
         SET status = 'done',
             assigned_to = ?2,
             updated_at = ?3
         WHERE task_id = ?1`
      ),
      taskId,
      auth.userId,
      Date.now()
    )
  );

  const dateKey = getUsageDateKey();

  const doneCountResult = await dbAll<{ count: number }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT COUNT(*) AS count
         FROM game_dungeon_tasks
         WHERE dungeon_id = ?1
           AND status = 'done'`
      ),
      task.dungeon_id
    )
  );

  const totalCountResult = await dbAll<{ count: number }>(
    dbBind(
      dbPrepare(
        env.DB,
        `SELECT COUNT(*) AS count
         FROM game_dungeon_tasks
         WHERE dungeon_id = ?1`
      ),
      task.dungeon_id
    )
  );

  const clearedCount = Number(doneCountResult.results?.[0]?.count ?? 0);
  const totalCount = Number(totalCountResult.results?.[0]?.count ?? 0);

  await dbRun(
    dbBind(
      dbPrepare(
        env.DB,
        `INSERT INTO user_dungeon_progress (user_id, date, dungeon_id, cleared_count, reward_claimed)
         VALUES (?1, ?2, ?3, ?4, 0)
         ON CONFLICT(user_id, date, dungeon_id) DO UPDATE SET
           cleared_count = excluded.cleared_count`
      ),
      auth.userId,
      dateKey,
      task.dungeon_id,
      clearedCount
    )
  );

  let unlockedDeck: { sourceId: string; headwordNorms: string[] } | null = null;

  if (totalCount > 0 && clearedCount >= totalCount) {
    const headwords = await dbAll<{ headword_norm: string }>(
      dbBind(
        dbPrepare(
          env.DB,
          `SELECT headword_norm
           FROM game_dungeon_tasks
           WHERE dungeon_id = ?1
           ORDER BY created_at ASC`
        ),
        task.dungeon_id
      )
    );

    const headwordNorms = (headwords.results ?? []).map((item) => item.headword_norm).filter(Boolean);
    unlockedDeck = {
      sourceId: task.dungeon_id,
      headwordNorms
    };

    await dbRun(
      dbBind(
        dbPrepare(
          env.DB,
          `UPDATE user_dungeon_progress
           SET reward_claimed = 1
           WHERE user_id = ?1
             AND date = ?2
             AND dungeon_id = ?3`
        ),
        auth.userId,
        dateKey,
        task.dungeon_id
      )
    );
  }

  const latestUsage = await getUsageSnapshot(env, auth.userId);

  return jsonResponse({
    ok: true,
    clearedCount,
    totalCount,
    usage: latestUsage,
    unlockedDeck
  });
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

    if (url.pathname === '/api/v1/auth/request-magic-link') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleRequestMagicLink(request, env);
    }

    if (url.pathname === '/api/v1/auth/verify-magic-link') {
      if (request.method !== 'GET') return methodNotAllowed();
      return handleVerifyMagicLink(request, env);
    }

    if (url.pathname === '/api/v1/auth/me') {
      if (request.method !== 'GET') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleAuthMe(env, auth);
    }

    if (url.pathname === '/api/v1/auth/link-account') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleLinkAccount(request, env, auth);
    }

    if (url.pathname === '/api/v1/sync/push') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleSyncPush(request, env, auth);
    }

    if (url.pathname === '/api/v1/sync/pull') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleSyncPull(request, env, auth);
    }

    if (url.pathname === '/api/v1/sync/progress') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleSyncProgress(request, env, auth);
    }

    if (url.pathname === '/api/v1/usage/report') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleUsageReport(request, env, auth);
    }

    if (url.pathname === '/api/v1/wordbank/decks') {
      if (request.method !== 'GET') return methodNotAllowed();
      return handleWordbankDecks(env);
    }

    if (url.pathname.startsWith('/api/v1/wordbank/decks/')) {
      if (request.method !== 'GET') return methodNotAllowed();
      const deckId = decodeURIComponent(url.pathname.replace('/api/v1/wordbank/decks/', '').replace('/words', ''));
      if (!url.pathname.endsWith('/words')) {
        return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
      }
      return handleWordbankDeckWords(env, deckId);
    }

    if (url.pathname === '/api/v1/wordbank/admin/upsert-words') {
      if (request.method !== 'POST') return methodNotAllowed();
      return handleWordbankAdminUpsert(request, env);
    }

    if (url.pathname === '/api/v1/community/changesets') {
      if (request.method !== 'POST') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleCommunityCreateChangeset(request, env, auth);
    }

    if (url.pathname.startsWith('/api/v1/community/changesets/')) {
      const rest = url.pathname.replace('/api/v1/community/changesets/', '');
      const [id, action] = rest.split('/');
      if (!id) return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
      const changesetId = decodeURIComponent(id);
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();

      if (action === 'items') {
        if (request.method !== 'POST') return methodNotAllowed();
        return handleCommunityAddItems(request, env, auth, changesetId);
      }
      if (action === 'submit') {
        if (request.method !== 'POST') return methodNotAllowed();
        let body: SubmitChangesetRequest;
        try {
          body = await request.json();
        } catch {
          body = {};
        }
        return handleCommunitySubmit(env, auth, changesetId, body);
      }
      if (action === 'review') {
        if (request.method !== 'POST') return methodNotAllowed();
        return handleCommunityReview(request, env, auth, changesetId);
      }
      if (action === 'merge') {
        if (request.method !== 'POST') return methodNotAllowed();
        return handleCommunityMerge(request, env, auth, changesetId);
      }

      return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
    }

    if (url.pathname === '/api/v1/community/tasks') {
      if (request.method !== 'GET') return methodNotAllowed();
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleCommunityTasks(env, auth);
    }

    if (url.pathname.startsWith('/api/v1/community/tasks/')) {
      if (request.method !== 'POST') return methodNotAllowed();
      const taskId = decodeURIComponent(url.pathname.replace('/api/v1/community/tasks/', '').replace('/complete', ''));
      if (!url.pathname.endsWith('/complete')) {
        return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
      }
      const auth = await requireAuth(request, env);
      if (!auth) return unauthorized();
      return handleCommunityCompleteTask(env, auth, taskId);
    }

    if (url.pathname.startsWith('/api/v1/community/lexeme/')) {
      if (request.method !== 'GET') return methodNotAllowed();
      const rawHeadword = decodeURIComponent(url.pathname.replace('/api/v1/community/lexeme/', ''));
      return handleCommunityLexeme(env, rawHeadword);
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

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
