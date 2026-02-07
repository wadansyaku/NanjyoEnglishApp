/**
 * Phase 2: 同期ライブラリ
 * ローカル ↔ クラウドのデータ同期
 */

import { getAuth, getAuthHeaders } from './auth';

// Storage keys
const SYNC_STORAGE_KEY = 'nanjyo.sync.lastSyncAt';

type SyncCard = {
    id: string;
    term: string;
    meaning: string;
    updatedAt: number;
};

type SyncDeck = {
    id: string;
    name: string;
    cards: SyncCard[];
    updatedAt: number;
};

type SyncProgress = {
    xpTotal: number;
    level: number;
    streakDays: number;
};

type PushRequest = {
    decks: SyncDeck[];
    progress?: SyncProgress;
    lastSyncAt?: number;
};

type PullResponse = {
    ok: boolean;
    decks: SyncDeck[];
    progress: SyncProgress;
    serverTime: number;
};

type PushResponse = {
    ok: boolean;
    syncedAt: number;
    deckCount: number;
};

type ProgressResponse = {
    ok: boolean;
    progress: SyncProgress;
    syncedAt: number;
};

/**
 * 最後の同期時刻を取得
 */
export const getLastSyncAt = (): number => {
    const stored = localStorage.getItem(SYNC_STORAGE_KEY);
    return stored ? parseInt(stored, 10) : 0;
};

/**
 * 最後の同期時刻を保存
 */
export const setLastSyncAt = (timestamp: number): void => {
    localStorage.setItem(SYNC_STORAGE_KEY, String(timestamp));
};

/**
 * ローカルデータをクラウドにプッシュ
 */
export const syncPush = async (data: PushRequest): Promise<PushResponse> => {
    const auth = getAuth();
    if (!auth) throw new Error('Not authenticated');

    const response = await fetch('/api/v1/sync/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        },
        body: JSON.stringify({
            ...data,
            lastSyncAt: getLastSyncAt()
        })
    });

    if (!response.ok) {
        const error = await response.json() as { message: string };
        throw new Error(error.message || 'Push failed');
    }

    const result = await response.json() as PushResponse;

    if (result.ok && result.syncedAt) {
        setLastSyncAt(result.syncedAt);
    }

    return result;
};

/**
 * クラウドからローカルにプル
 */
export const syncPull = async (): Promise<PullResponse> => {
    const auth = getAuth();
    if (!auth) throw new Error('Not authenticated');

    const response = await fetch('/api/v1/sync/pull', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        },
        body: JSON.stringify({
            lastSyncAt: getLastSyncAt()
        })
    });

    if (!response.ok) {
        const error = await response.json() as { message: string };
        throw new Error(error.message || 'Pull failed');
    }

    const result = await response.json() as PullResponse;

    if (result.ok && result.serverTime) {
        setLastSyncAt(result.serverTime);
    }

    return result;
};

/**
 * XP/Level/Streakの同期
 */
export const syncProgress = async (progress: SyncProgress): Promise<ProgressResponse> => {
    const auth = getAuth();
    if (!auth) throw new Error('Not authenticated');

    const response = await fetch('/api/v1/sync/progress', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        },
        body: JSON.stringify(progress)
    });

    if (!response.ok) {
        const error = await response.json() as { message: string };
        throw new Error(error.message || 'Progress sync failed');
    }

    const result = await response.json() as ProgressResponse;

    if (result.ok && result.syncedAt) {
        setLastSyncAt(result.syncedAt);
    }

    return result;
};

/**
 * 同期状態のリセット
 */
export const resetSyncState = (): void => {
    localStorage.removeItem(SYNC_STORAGE_KEY);
};

/**
 * 同期可能かどうか（認証済みかつメール確認済み）
 */
export const isSyncEnabled = (): boolean => {
    const auth = getAuth();
    return auth?.isEmailVerified === true;
};
