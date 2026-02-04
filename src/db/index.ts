import Dexie, { type Table } from 'dexie';
import { LIMITS } from '../../shared/limits';
import { normalizeHeadword } from '../../shared/validation';
import type { LexemeInput } from '../../shared/types';
import { applyReview, type ReviewResult, type SrsState } from '../lib/srs';

export type Lexeme = {
  headword: string;
  meaning: string;
  example: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
};

export type ReviewLog = {
  id?: number;
  headword: string;
  result: ReviewResult;
  timestamp: number;
};

export type OutputLog = {
  id?: number;
  headword: string;
  type: 'composition' | 'recording';
  text?: string;
  timestamp: number;
};

export type Recording = {
  id?: number;
  headword: string;
  blob: Blob;
  timestamp: number;
};

export type SyncQueueItem = {
  headword: string;
  meaning: string;
  example: string;
  note: string;
  queuedAt: number;
};

export type Profile = {
  id: 'main';
  xp: number;
  level: number;
};

class AppDB extends Dexie {
  lexemes!: Table<Lexeme, string>;
  srs!: Table<SrsState, string>;
  reviewLogs!: Table<ReviewLog, number>;
  outputs!: Table<OutputLog, number>;
  recordings!: Table<Recording, number>;
  syncQueue!: Table<SyncQueueItem, string>;
  profile!: Table<Profile, 'main'>;

  constructor() {
    super('nanjyoEnglishApp');
    this.version(1).stores({
      lexemes: '&headword, updatedAt, syncedAt',
      srs: '&headword, dueAt',
      reviewLogs: '++id, headword, timestamp',
      outputs: '++id, headword, type, timestamp',
      recordings: '++id, headword, timestamp',
      syncQueue: '&headword, queuedAt',
      profile: '&id'
    });
  }
}

export const db = new AppDB();

export const saveLexemes = async (drafts: LexemeInput[]) => {
  const now = Date.now();
  await db.transaction('rw', db.lexemes, db.srs, db.syncQueue, async () => {
    for (const draft of drafts) {
      const headword = normalizeHeadword(draft.headword);
      if (!headword) continue;
      const existing = await db.lexemes.get(headword);
      const lexeme: Lexeme = {
        headword,
        meaning: draft.meaning?.trim() || existing?.meaning || '',
        example: draft.example?.trim() || existing?.example || '',
        note: draft.note?.trim() || existing?.note || '',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        syncedAt: existing?.syncedAt
      };
      await db.lexemes.put(lexeme);

      const existingSrs = await db.srs.get(headword);
      if (!existingSrs) {
        await db.srs.put({
          headword,
          dueAt: now,
          intervalDays: 0,
          ease: 2.4,
          correctStreak: 0
        });
      }

      await db.syncQueue.put({
        headword,
        meaning: lexeme.meaning,
        example: lexeme.example,
        note: lexeme.note,
        queuedAt: now
      });
    }
  });
};

export const listLexemes = async () => db.lexemes.orderBy('headword').toArray();

export const getProfile = async () => {
  const profile = await db.profile.get('main');
  if (profile) return profile;
  const initial = { id: 'main', xp: 0, level: 1 } satisfies Profile;
  await db.profile.put(initial);
  return initial;
};

const XP_STEP = 120;

export const addXp = async (amount: number) => {
  const profile = await getProfile();
  const xp = Math.max(0, profile.xp + amount);
  const level = Math.floor(xp / XP_STEP) + 1;
  const updated = { ...profile, xp, level };
  await db.profile.put(updated);
  return {
    ...updated,
    progress: xp % XP_STEP,
    next: XP_STEP
  };
};

export const getNextDue = async () => {
  const now = Date.now();
  const next = await db.srs.where('dueAt').belowOrEqual(now).first();
  if (!next) return null;
  const lexeme = await db.lexemes.get(next.headword);
  if (!lexeme) return null;
  return { lexeme, srs: next };
};

export const recordReview = async (headword: string, result: ReviewResult) => {
  const state = await db.srs.get(headword);
  if (!state) return null;
  const now = Date.now();
  const updated = applyReview(state, result, now);
  await db.transaction('rw', db.srs, db.reviewLogs, async () => {
    await db.srs.put(updated);
    await db.reviewLogs.add({ headword, result, timestamp: now });
  });

  const xp = result === 'again' ? 2 : result === 'good' ? 10 : 15;
  await addXp(xp);
  return updated;
};

export const saveComposition = async (headword: string, text: string) => {
  const now = Date.now();
  await db.outputs.add({ headword, type: 'composition', text, timestamp: now });
  await addXp(8);
};

export const saveRecording = async (headword: string, blob: Blob) => {
  const now = Date.now();
  await db.recordings.add({ headword, blob, timestamp: now });
  await db.outputs.add({ headword, type: 'recording', timestamp: now });
  await addXp(12);
};

export const syncLexemes = async () => {
  const queued = await db.syncQueue.orderBy('queuedAt').limit(LIMITS.batchMaxItems).toArray();
  if (queued.length === 0) {
    return { synced: 0, remaining: 0 };
  }

  const response = await fetch('/api/lexemes/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: queued.map((item) => ({
        headword: item.headword,
        meaning: item.meaning,
        example: item.example,
        note: item.note
      }))
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to sync.');
  }

  const now = Date.now();
  await db.transaction('rw', db.lexemes, db.syncQueue, async () => {
    for (const item of queued) {
      const lexeme = await db.lexemes.get(item.headword);
      if (lexeme) {
        await db.lexemes.put({ ...lexeme, syncedAt: now });
      }
      await db.syncQueue.delete(item.headword);
    }
  });

  const remaining = await db.syncQueue.count();
  return { synced: queued.length, remaining };
};
