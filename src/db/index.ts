import Dexie, { type Table } from 'dexie';
import { applySm2, createInitialSrsState, type ReviewGrade, type SrsState } from '../lib/srs';

export type LexemeCache = {
  headwordNorm: string;
  headword: string;
  meaningJa: string;
  updatedAt: number;
};

export type Deck = {
  deckId: string;
  title: string;
  headwordNorms: string[];
  createdAt: number;
};

export type XpState = {
  id: 'main';
  xpTotal: number;
  level: number;
};

export type DailyXp = {
  date: string;
  earned: number;
};

export type EventCounter = {
  name: string;
  count: number;
  updatedAt: number;
};

export type DueCard = {
  srs: SrsState;
  lexeme: LexemeCache;
};

export type XpSummary = {
  xpTotal: number;
  level: number;
  dailyEarned: number;
  dailyLimit: number;
  dailyRemaining: number;
};

export type DeckDueSummary = {
  deckId: string;
  title: string;
  dueCount: number;
  totalCards: number;
};

const XP_DAILY_LIMIT = 300;
const XP_PER_LEVEL = 100;

const getDateKey = (date = new Date()) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export const normalizeHeadword = (value: string) => {
  const lowered = value.toLowerCase();
  const parts = lowered.match(/[a-z']+/g);
  return parts ? parts.join('') : '';
};

class AppDB extends Dexie {
  lexemeCache!: Table<LexemeCache, string>;
  decks!: Table<Deck, string>;
  srs!: Table<SrsState, string>;
  xp!: Table<XpState, 'main'>;
  xpDaily!: Table<DailyXp, string>;
  eventCounters!: Table<EventCounter, string>;

  constructor() {
    super('nanjyoEnglishApp');
    this.version(3).stores({
      lexemeCache: '&headwordNorm, updatedAt',
      decks: '&deckId, createdAt',
      srs: '&cardId, deckId, dueAt, [deckId+dueAt]',
      xp: '&id',
      xpDaily: '&date',
      eventCounters: '&name, updatedAt'
    });
  }
}

export const db = new AppDB();

export const createDeck = async (title: string) => {
  const deck: Deck = {
    deckId: crypto.randomUUID(),
    title,
    headwordNorms: [],
    createdAt: Date.now()
  };
  await db.decks.put(deck);
  return deck;
};

export const listDecks = async () => db.decks.orderBy('createdAt').toArray();

export const getDeck = async (deckId: string) => db.decks.get(deckId);

export const addLexemeToDeck = async (
  deckId: string,
  input: { headword: string; meaningJa: string }
) => {
  const headword = input.headword.trim();
  const meaningJa = input.meaningJa.trim();
  const headwordNorm = normalizeHeadword(headword);
  if (!headwordNorm) return;

  const now = Date.now();
  await db.transaction('rw', db.lexemeCache, db.decks, db.srs, async () => {
    await db.lexemeCache.put({
      headwordNorm,
      headword,
      meaningJa,
      updatedAt: now
    });

    const deck = await db.decks.get(deckId);
    if (!deck) return;
    const norms = new Set(deck.headwordNorms);
    norms.add(headwordNorm);
    await db.decks.put({ ...deck, headwordNorms: [...norms] });

    const cardId = `${deckId}:${headwordNorm}`;
    const existing = await db.srs.get(cardId);
    if (!existing) {
      await db.srs.put(createInitialSrsState(cardId, deckId, headwordNorm, now));
    }
  });
};

export const getDueCard = async (deckId: string): Promise<DueCard | null> => {
  const now = Date.now();
  const srs = await db.srs
    .where('[deckId+dueAt]')
    .between([deckId, 0], [deckId, now])
    .first();
  if (!srs) return null;
  const lexeme = await db.lexemeCache.get(srs.headwordNorm);
  if (!lexeme) return null;
  return { srs, lexeme };
};

export const getDueCount = async (deckId: string) => {
  const now = Date.now();
  return db.srs.where('[deckId+dueAt]').between([deckId, 0], [deckId, now]).count();
};

export const listDeckDueSummaries = async (): Promise<DeckDueSummary[]> => {
  const decks = await listDecks();
  const summaries = await Promise.all(
    decks.map(async (deck) => {
      const dueCount = await getDueCount(deck.deckId);
      return {
        deckId: deck.deckId,
        title: deck.title,
        dueCount,
        totalCards: deck.headwordNorms.length
      };
    })
  );
  return summaries.sort((a, b) => b.dueCount - a.dueCount || a.title.localeCompare(b.title));
};

export const getTodayDueTotal = async () => {
  const summaries = await listDeckDueSummaries();
  return summaries.reduce((sum, item) => sum + item.dueCount, 0);
};

const getOrCreateXp = async () => {
  const current = await db.xp.get('main');
  if (current) return current;
  const initial: XpState = { id: 'main', xpTotal: 0, level: 1 };
  await db.xp.put(initial);
  return initial;
};

const getOrCreateDailyXp = async (dateKey: string) => {
  const current = await db.xpDaily.get(dateKey);
  if (current) return current;
  const initial: DailyXp = { date: dateKey, earned: 0 };
  await db.xpDaily.put(initial);
  return initial;
};

const awardXp = async (grade: ReviewGrade, wasDue: boolean) => {
  if (!wasDue) return;
  const gradeXp: Record<ReviewGrade, number> = {
    again: 0,
    hard: 1,
    good: 2,
    easy: 3
  };
  const base = gradeXp[grade];
  if (base <= 0) return;
  const dateKey = getDateKey();

  await db.transaction('rw', db.xp, db.xpDaily, async () => {
    const xpState = await getOrCreateXp();
    const daily = await getOrCreateDailyXp(dateKey);
    const remaining = Math.max(0, XP_DAILY_LIMIT - daily.earned);
    const granted = Math.min(base, remaining);
    if (granted <= 0) return;
    const xpTotal = xpState.xpTotal + granted;
    const level = Math.floor(xpTotal / XP_PER_LEVEL) + 1;
    await db.xp.put({ ...xpState, xpTotal, level });
    await db.xpDaily.put({ ...daily, earned: daily.earned + granted });
  });
};

export const reviewCard = async (deckId: string, cardId: string, grade: ReviewGrade) => {
  const now = Date.now();
  await db.transaction('rw', db.srs, db.xp, db.xpDaily, db.eventCounters, async () => {
    const state = await db.srs.get(cardId);
    if (!state || state.deckId !== deckId) return;
    const updated = applySm2(state, grade, now);
    await db.srs.put(updated);
    await awardXp(grade, now >= state.dueAt);
  });
};

export const getXpSummary = async (): Promise<XpSummary> => {
  const xpState = await getOrCreateXp();
  const daily = await getOrCreateDailyXp(getDateKey());
  const remaining = Math.max(0, XP_DAILY_LIMIT - daily.earned);
  return {
    xpTotal: xpState.xpTotal,
    level: xpState.level,
    dailyEarned: daily.earned,
    dailyLimit: XP_DAILY_LIMIT,
    dailyRemaining: remaining
  };
};

export const incrementEvent = async (name: string) => {
  const now = Date.now();
  await db.transaction('rw', db.eventCounters, async () => {
    const current = await db.eventCounters.get(name);
    if (current) {
      await db.eventCounters.put({
        ...current,
        count: current.count + 1,
        updatedAt: now
      });
      return;
    }
    await db.eventCounters.put({ name, count: 1, updatedAt: now });
  });
};

export const listEventCounters = async () =>
  db.eventCounters.orderBy('updatedAt').reverse().toArray();
