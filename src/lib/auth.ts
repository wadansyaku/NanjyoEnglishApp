/**
 * Phase 2: 認証ライブラリ
 * マジックリンク認証 + セッション管理
 */

export type AuthSession = {
  userId: string;
  apiKey: string;
  avatarSeed: string;
  email?: string;
  isEmailVerified: boolean;
};

const STORAGE_KEY = 'nanjyo.auth.v2';
const PENDING_EMAIL_KEY = 'nanjyo.auth.pending_email.v1';

export class AuthApiError extends Error {
  code?: string;
  retryAfter?: number;

  constructor(message: string, options?: { code?: string; retryAfter?: number }) {
    super(message);
    this.code = options?.code;
    this.retryAfter = options?.retryAfter;
  }
}

const loadAuth = (): AuthSession | null => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.userId || !parsed?.apiKey) return null;
    return parsed;
  } catch {
    return null;
  }
};

const saveAuth = (session: AuthSession) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

const clearAuth = () => {
  localStorage.removeItem(STORAGE_KEY);
};

const savePendingEmail = (email: string) => {
  localStorage.setItem(PENDING_EMAIL_KEY, email);
};

export const getPendingEmail = () => localStorage.getItem(PENDING_EMAIL_KEY) ?? '';

const clearPendingEmail = () => {
  localStorage.removeItem(PENDING_EMAIL_KEY);
};

// Migrate from v1 storage format
const migrateFromV1 = (): AuthSession | null => {
  const oldKey = 'nanjyo.auth.v1';
  const raw = localStorage.getItem(oldKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { userId: string; apiKey: string; avatarSeed: string };
    if (!parsed?.userId || !parsed?.apiKey) return null;
    const session: AuthSession = {
      ...parsed,
      isEmailVerified: false
    };
    saveAuth(session);
    localStorage.removeItem(oldKey);
    return session;
  } catch {
    return null;
  }
};

/**
 * 匿名ユーザーを作成（バックエンドbootstrap）
 */
export const bootstrapAuth = async (): Promise<AuthSession> => {
  const response = await fetch('/api/v1/bootstrap', { method: 'POST' });
  if (!response.ok) {
    throw new Error('Failed to bootstrap auth');
  }
  const data = (await response.json()) as {
    userId: string;
    apiKey: string;
    avatarSeed: string;
  };
  const session: AuthSession = {
    userId: data.userId,
    apiKey: data.apiKey,
    avatarSeed: data.avatarSeed,
    isEmailVerified: false
  };
  saveAuth(session);
  return session;
};

/**
 * 認証を確保（既存セッションがなければ匿名作成）
 */
export const ensureAuth = async (): Promise<AuthSession> => {
  // Try v2 first
  let cached = loadAuth();
  if (cached) return cached;

  // Migrate from v1
  cached = migrateFromV1();
  if (cached) return cached;

  // Create new anonymous user
  return bootstrapAuth();
};

/**
 * 現在のセッションを取得（なければnull）
 */
export const getAuth = (): AuthSession | null => {
  return loadAuth();
};

/**
 * マジックリンク送信リクエスト
 */
export const requestMagicLink = async (email: string): Promise<{ ok: boolean; message: string; magicLink?: string }> => {
  const response = await fetch('/api/v1/auth/request-magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });

  const data = await response.json() as {
    ok: boolean;
    message: string;
    code?: string;
    retryAfter?: number;
    _dev?: { magicLink: string };
  };

  if (!response.ok) {
    throw new AuthApiError(data.message || 'マジックリンク送信に失敗しました。', {
      code: data.code,
      retryAfter: data.retryAfter
    });
  }

  if (data.ok) {
    savePendingEmail(email.trim().toLowerCase());
  }

  return {
    ok: data.ok,
    message: data.message,
    magicLink: data._dev?.magicLink // Development only
  };
};

/**
 * マジックリンク検証（認証完了）
 */
export const verifyMagicLink = async (token: string): Promise<AuthSession> => {
  const response = await fetch(`/api/v1/auth/verify-magic-link?token=${encodeURIComponent(token)}`);

  if (!response.ok) {
    const data = await response.json() as { message?: string; code?: string; retryAfter?: number };
    throw new AuthApiError(data.message || '認証に失敗しました。', {
      code: data.code,
      retryAfter: data.retryAfter
    });
  }

  const data = await response.json() as {
    ok: boolean;
    userId: string;
    apiKey: string;
    avatarSeed: string;
    email: string;
    isNewUser: boolean;
  };

  const session: AuthSession = {
    userId: data.userId,
    apiKey: data.apiKey,
    avatarSeed: data.avatarSeed,
    email: data.email,
    isEmailVerified: true
  };

  saveAuth(session);
  clearPendingEmail();
  return session;
};

/**
 * 現在のユーザー情報を取得
 */
export const fetchCurrentUser = async (): Promise<{
  userId: string;
  email: string | null;
  avatarSeed: string;
  xpTotal: number;
  level: number;
  streakDays: number;
} | null> => {
  const auth = loadAuth();
  if (!auth) return null;

  const response = await fetch('/api/v1/auth/me', {
    headers: { 'Authorization': `Bearer ${auth.apiKey}` }
  });

  if (!response.ok) return null;

  const data = await response.json() as {
    ok: boolean;
    user: {
      userId: string;
      email: string | null;
      avatarSeed: string;
      xpTotal: number;
      level: number;
      streakDays: number;
    };
  };

  return data.user;
};

/**
 * 匿名アカウントにメールを紐付け
 */
export const linkAccount = async (email: string): Promise<{ ok: boolean; message: string; magicLink?: string }> => {
  const auth = loadAuth();
  if (!auth) throw new Error('Not authenticated');

  const response = await fetch('/api/v1/auth/link-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.apiKey}`
    },
    body: JSON.stringify({ email })
  });

  const data = await response.json() as {
    ok: boolean;
    message: string;
    code?: string;
    retryAfter?: number;
    _dev?: { magicLink: string };
  };

  if (!response.ok) {
    throw new AuthApiError(data.message || 'リンク送信に失敗しました。', {
      code: data.code,
      retryAfter: data.retryAfter
    });
  }

  if (data.ok) {
    savePendingEmail(email.trim().toLowerCase());
  }

  return {
    ok: data.ok,
    message: data.message,
    magicLink: data._dev?.magicLink
  };
};

/**
 * ログアウト
 */
export const logout = () => {
  clearAuth();
  clearPendingEmail();
};

export const revokeCurrentSession = async () => {
  const auth = loadAuth();
  if (!auth) {
    clearAuth();
    clearPendingEmail();
    return;
  }
  try {
    await fetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.apiKey}`
      }
    });
  } catch {
    // Best-effort revoke; clear local session regardless.
  } finally {
    clearAuth();
    clearPendingEmail();
  }
};

/**
 * 認証済みかどうか
 */
export const isAuthenticated = (): boolean => {
  const auth = loadAuth();
  return auth !== null;
};

/**
 * メール認証済みかどうか
 */
export const isEmailVerified = (): boolean => {
  const auth = loadAuth();
  return auth?.isEmailVerified === true;
};

/**
 * APIリクエスト用のヘッダーを取得
 */
export const getAuthHeaders = (): Record<string, string> => {
  const auth = loadAuth();
  if (!auth) return {};
  return { 'Authorization': `Bearer ${auth.apiKey}` };
};
