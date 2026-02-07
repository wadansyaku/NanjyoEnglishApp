const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'if',
  'then',
  'than',
  'this',
  'that',
  'these',
  'those',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'as',
  'by',
  'at',
  'from',
  'it',
  'its',
  'he',
  'she',
  'they',
  'them',
  'we',
  'you',
  'i',
  'me',
  'my',
  'your',
  'our',
  'their'
]);

export type CandidateWord = {
  word: string;
  count: number;
  quality: 'ok' | 'review';
};

const normalizeToken = (value: string) => value.toLowerCase().replace(/’/g, "'");

const isGarbageToken = (token: string) => {
  if (token.length < 2) return true;
  if (!/[a-z]/.test(token)) return true;
  const symbolRatio = (token.match(/[^a-z0-9']/g) ?? []).length / token.length;
  if (symbolRatio > 0.34) return true;
  const digitRatio = (token.match(/[0-9]/g) ?? []).length / token.length;
  if (digitRatio > 0.4) return true;
  return false;
};

const inferQuality = (token: string): 'ok' | 'review' => {
  if (/[0-9]/.test(token)) return 'review';
  if (/[^a-z']/g.test(token)) return 'review';
  if (token.length > 16) return 'review';
  if (/([a-z])\1{3,}/.test(token)) return 'review';
  return 'ok';
};

export const extractCandidates = (text: string): CandidateWord[] => {
  const stats = new Map<string, { count: number; quality: 'ok' | 'review' }>();
  const matches = text.match(/[A-Za-z0-9'’.-]+/g) || [];
  for (const raw of matches) {
    const token = normalizeToken(raw);
    if (isGarbageToken(token)) continue;
    const word = token.replace(/[^a-z']/g, '');
    if (!word) continue;
    if (word.length < 2) continue;
    if (STOP_WORDS.has(word)) continue;
    const nextQuality = inferQuality(token);
    const prev = stats.get(word);
    if (!prev) {
      stats.set(word, { count: 1, quality: nextQuality });
      continue;
    }
    stats.set(word, {
      count: prev.count + 1,
      quality: prev.quality === 'review' ? 'review' : nextQuality
    });
  }
  return [...stats.entries()]
    .map(([word, value]) => ({ word, count: value.count, quality: value.quality }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
};
