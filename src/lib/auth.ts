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
  authMethod?: 'magic-link' | 'passkey';
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
 * 認証を確保（ログイン必須）
 */
export const ensureAuth = async (): Promise<AuthSession> => {
  // Try v2 first
  let cached = loadAuth();
  if (isSessionVerified(cached)) return cached;

  // Migrate from v1
  cached = migrateFromV1();
  if (isSessionVerified(cached)) return cached;

  throw new AuthApiError('ログインが必要です。', { code: 'AUTH_REQUIRED' });
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
    isEmailVerified: true,
    authMethod: 'magic-link'
  };

  saveAuth(session);
  clearPendingEmail();
  return session;
};

export type PasskeyRegisterOptions = {
  challenge: string;
  domain?: string;
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  timeout?: number;
  userVerification?: 'required' | 'preferred' | 'discouraged';
  discoverable?: 'required' | 'preferred' | 'discouraged';
  hints?: Array<'client-device' | 'hybrid' | 'security-key'>;
};

export type PasskeyLoginOptions = {
  challenge: string;
  domain?: string;
  timeout?: number;
  userVerification?: 'required' | 'preferred' | 'discouraged';
  hints?: Array<'client-device' | 'hybrid' | 'security-key'>;
};

export const requestPasskeyRegisterOptions = async (displayName: string) => {
  const response = await fetch('/api/v1/auth/passkey/register/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName })
  });
  const data = await response.json() as {
    ok?: boolean;
    message?: string;
    code?: string;
    retryAfter?: number;
    challengeId?: string;
    options?: PasskeyRegisterOptions;
  };
  if (!response.ok || !data.ok || !data.challengeId || !data.options) {
    throw new AuthApiError(data.message || 'Passkey登録の準備に失敗しました。', {
      code: data.code,
      retryAfter: data.retryAfter
    });
  }
  return { challengeId: data.challengeId, options: data.options };
};

export const verifyPasskeyRegister = async (input: {
  challengeId: string;
  registration: unknown;
}): Promise<AuthSession> => {
  const response = await fetch('/api/v1/auth/passkey/register/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  const data = await response.json() as {
    ok?: boolean;
    message?: string;
    code?: string;
    retryAfter?: number;
    userId?: string;
    apiKey?: string;
    avatarSeed?: string;
    email?: string | null;
  };
  if (!response.ok || !data.ok || !data.userId || !data.apiKey || !data.avatarSeed) {
    throw new AuthApiError(data.message || 'Passkey登録に失敗しました。', {
      code: data.code,
      retryAfter: data.retryAfter
    });
  }
  const session: AuthSession = {
    userId: data.userId,
    apiKey: data.apiKey,
    avatarSeed: data.avatarSeed,
    email: data.email ?? undefined,
    isEmailVerified: true,
    authMethod: 'passkey'
  };
  saveAuth(session);
  return session;
};

export const requestPasskeyLoginOptions = async () => {
  const response = await fetch('/api/v1/auth/passkey/login/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  const data = await response.json() as {
    ok?: boolean;
    message?: string;
    code?: string;
    retryAfter?: number;
    challengeId?: string;
    options?: PasskeyLoginOptions;
  };
  if (!response.ok || !data.ok || !data.challengeId || !data.options) {
    throw new AuthApiError(data.message || 'Passkeyログインの準備に失敗しました。', {
      code: data.code,
      retryAfter: data.retryAfter
    });
  }
  return { challengeId: data.challengeId, options: data.options };
};

export const verifyPasskeyLogin = async (input: {
  challengeId: string;
  authentication: unknown;
}): Promise<AuthSession> => {
  const response = await fetch('/api/v1/auth/passkey/login/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  const data = await response.json() as {
    ok?: boolean;
    message?: string;
    code?: string;
    retryAfter?: number;
    userId?: string;
    apiKey?: string;
    avatarSeed?: string;
    email?: string | null;
  };
  if (!response.ok || !data.ok || !data.userId || !data.apiKey || !data.avatarSeed) {
    throw new AuthApiError(data.message || 'Passkeyログインに失敗しました。', {
      code: data.code,
      retryAfter: data.retryAfter
    });
  }
  const session: AuthSession = {
    userId: data.userId,
    apiKey: data.apiKey,
    avatarSeed: data.avatarSeed,
    email: data.email ?? undefined,
    isEmailVerified: true,
    authMethod: 'passkey'
  };
  saveAuth(session);
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
  return isSessionVerified(auth);
};

/**
 * APIリクエスト用のヘッダーを取得
 */
export const getAuthHeaders = (): Record<string, string> => {
  const auth = loadAuth();
  if (!auth) return {};
  return { 'Authorization': `Bearer ${auth.apiKey}` };
};
const isSessionVerified = (session: AuthSession | null): session is AuthSession =>
  Boolean(session && (session.isEmailVerified || session.authMethod === 'passkey'));
