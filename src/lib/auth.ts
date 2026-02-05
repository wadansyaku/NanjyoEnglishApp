type AuthSession = {
  userId: string;
  apiKey: string;
  avatarSeed: string;
};

const STORAGE_KEY = 'nanjyo.auth.v1';

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
    avatarSeed: data.avatarSeed
  };
  saveAuth(session);
  return session;
};

export const ensureAuth = async (): Promise<AuthSession> => {
  const cached = loadAuth();
  if (cached) return cached;
  return bootstrapAuth();
};
