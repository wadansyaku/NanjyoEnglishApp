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
};

export const extractCandidates = (text: string): CandidateWord[] => {
  const counts = new Map<string, number>();
  const matches = text.toLowerCase().match(/[a-z][a-z']*/g) || [];
  for (const word of matches) {
    if (word.length < 2) continue;
    if (STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
};
