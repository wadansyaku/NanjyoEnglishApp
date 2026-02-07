import Dexie, { type Table } from 'dexie';
import { applySm2, createInitialSrsState, type ReviewGrade, type SrsState } from '../lib/srs';
import { normalizeHeadword } from '../../shared/headword';
import { isMastered } from '../../shared/mastery';

export { normalizeHeadword };

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
  origin?: 'custom' | 'core' | 'dungeon';
  sourceId?: string;
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

/**
 * 対数XPカーブ: レベルNに必要な累計XPを計算
 * 行動心理学に基づき、初期は達成しやすく、高レベルほど努力が必要
 * 公式: totalXP = BASE * (SCALE^level - 1) / (SCALE - 1)
 * Level 1: 0 XP, Level 2: 30 XP, Level 3: 69 XP, Level 5: 176 XP, Level 10: 878 XP
 */
const XP_LEVEL_BASE = 30;  // レベル2に必要な基準XP
const XP_LEVEL_SCALE = 1.3; // 各レベルで必要XPが1.3倍に増加

/** レベルNに到達するために必要な累計XP */
export const getXpRequiredForLevel = (level: number): number => {
  if (level <= 1) return 0;
  // 幾何級数の和: base * (scale^(n-1) - 1) / (scale - 1)
  return Math.floor(XP_LEVEL_BASE * (Math.pow(XP_LEVEL_SCALE, level - 1) - 1) / (XP_LEVEL_SCALE - 1));
};

/** 現在の累計XPからレベルを算出 */
export const getLevelFromXp = (xpTotal: number): number => {
  if (xpTotal <= 0) return 1;
  // 逆算: level = 1 + log_scale(1 + xpTotal * (scale - 1) / base)
  const inner = 1 + (xpTotal * (XP_LEVEL_SCALE - 1)) / XP_LEVEL_BASE;
  const level = 1 + Math.floor(Math.log(inner) / Math.log(XP_LEVEL_SCALE));
  return Math.max(1, level);
};

/** 次のレベルまでに必要な残りXP */
export const getXpToNextLevel = (xpTotal: number): { current: number; required: number; progress: number } => {
  const level = getLevelFromXp(xpTotal);
  const currentLevelXp = getXpRequiredForLevel(level);
  const nextLevelXp = getXpRequiredForLevel(level + 1);
  const neededForThisLevel = nextLevelXp - currentLevelXp;
  const progressInLevel = xpTotal - currentLevelXp;
  return {
    current: progressInLevel,
    required: neededForThisLevel,
    progress: neededForThisLevel > 0 ? progressInLevel / neededForThisLevel : 1
  };
};

const getDateKey = (date = new Date()) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
    createdAt: Date.now(),
    origin: 'custom'
  };
  await db.decks.put(deck);
  return deck;
};

export type WordbankWord = {
  headwordNorm: string;
  headword: string;
  meaningJaShort: string;
};

export const createOrUpdateSystemDeck = async (input: {
  sourceId: string;
  title: string;
  origin: 'core' | 'dungeon';
  words: WordbankWord[];
}) => {
  const deckId = `${input.origin}:${input.sourceId}`;
  const now = Date.now();
  const uniqueWords = new Map<string, WordbankWord>();
  for (const word of input.words) {
    const headwordNorm = normalizeHeadword(word.headwordNorm || word.headword);
    if (!headwordNorm) continue;
    if (!uniqueWords.has(headwordNorm)) {
      uniqueWords.set(headwordNorm, {
        headwordNorm,
        headword: word.headword.trim(),
        meaningJaShort: word.meaningJaShort.trim()
      });
    }
  }

  const headwordNorms = [...uniqueWords.keys()];

  await db.transaction('rw', db.decks, db.lexemeCache, db.srs, async () => {
    const existing = await db.decks.get(deckId);
    await db.decks.put({
      deckId,
      title: input.title,
      headwordNorms,
      createdAt: existing?.createdAt ?? now,
      origin: input.origin,
      sourceId: input.sourceId
    });

    for (const word of uniqueWords.values()) {
      await db.lexemeCache.put({
        headwordNorm: word.headwordNorm,
        headword: word.headword,
        meaningJa: word.meaningJaShort,
        updatedAt: now
      });
      const cardId = `${deckId}:${word.headwordNorm}`;
      const existingCard = await db.srs.get(cardId);
      if (!existingCard) {
        await db.srs.put(createInitialSrsState(cardId, deckId, word.headwordNorm, now));
      }
    }
  });

  return deckId;
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
    const level = getLevelFromXp(xpTotal);
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

export const getMasteredHeadwordNormSet = async () => {
  const all = await db.srs.toArray();
  const set = new Set<string>();
  for (const state of all) {
    if (isMastered(state)) {
      set.add(state.headwordNorm);
    }
  }
  return set;
};

export const getWeeklyXpHistory = async (): Promise<DailyXp[]> => {
  const history: DailyXp[] = [];
  const today = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const key = `${yyyy}-${mm}-${dd}`;

    const record = await db.xpDaily.get(key);
    history.push(record || { date: key, earned: 0 });
  }

  return history;
};

/**
 * Quick Review用: 苦手な単語・期限切れの単語を最大limit件取得
 * ペルソナ「莉乃」の「今日の3分」モード用
 */
export const getQuickReviewCards = async (limit = 5): Promise<DueCard[]> => {
  const now = Date.now();
  // 期限切れのカードを取得（複数デッキにまたがって）
  const overdueCards = await db.srs
    .where('dueAt')
    .below(now)
    .limit(limit * 2) // 余裕を持って取得
    .toArray();

  // lapsesが多い順（苦手）→ repsが少ない順（復習回数少）にソート
  overdueCards.sort((a, b) => {
    if (b.lapses !== a.lapses) return b.lapses - a.lapses;
    return a.reps - b.reps;
  });

  const results: DueCard[] = [];
  for (const srs of overdueCards.slice(0, limit)) {
    const lexeme = await db.lexemeCache.get(srs.headwordNorm);
    if (lexeme) {
      results.push({ srs, lexeme });
    }
  }
  return results;
};

/**
 * Quick Review用: 期限切れカードの総数を取得
 */
export const getQuickReviewCount = async (): Promise<number> => {
  const now = Date.now();
  return db.srs.where('dueAt').below(now).count();
};
