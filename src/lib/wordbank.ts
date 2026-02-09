export type WordbankDeckWord = {
  headwordNorm: string;
  headword: string;
  meaningJaShort: string;
};

export type WordbankCurriculumStep = {
  stepId: string;
  title: string;
  description: string;
  deckIds: string[];
  wordCount: number;
  note?: string;
  recommendedChunk?: number;
};

export type WordbankCurriculumTrack = {
  trackId: string;
  title: string;
  description: string;
  steps: WordbankCurriculumStep[];
};

export type WordbankCurriculumResponse = {
  ok: boolean;
  tracks?: WordbankCurriculumTrack[];
  allRange?: {
    deckId: string;
    title: string;
    description: string;
    wordCount: number;
  } | null;
};

const dedupeWords = (words: WordbankDeckWord[]) => {
  const map = new Map<string, WordbankDeckWord>();
  for (const word of words) {
    const key = (word.headwordNorm || '').trim();
    if (!key || map.has(key)) continue;
    map.set(key, word);
  }
  return [...map.values()];
};

export const fetchWordbankCurriculum = async (): Promise<WordbankCurriculumResponse> => {
  const response = await fetch('/api/v1/wordbank/curriculum');
  if (!response.ok) {
    throw new Error('学校単語帳カリキュラムを取得できませんでした。');
  }
  return (await response.json()) as WordbankCurriculumResponse;
};

export const fetchWordbankStepWords = async (step: WordbankCurriculumStep) => {
  if (step.deckIds.length === 0) return [] as WordbankDeckWord[];
  try {
    const response = await fetch('/api/v1/wordbank/decks/words-batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deckIds: step.deckIds })
    });
    if (response.ok) {
      const data = (await response.json()) as {
        ok: boolean;
        words?: WordbankDeckWord[];
      };
      return dedupeWords(data.words ?? []);
    }
  } catch {
    // fall through to deck-by-deck fallback
  }

  const words: WordbankDeckWord[] = [];
  for (const deckId of step.deckIds) {
    const response = await fetch(`/api/v1/wordbank/decks/${encodeURIComponent(deckId)}/words`);
    if (!response.ok) continue;
    const data = (await response.json()) as {
      ok: boolean;
      words?: WordbankDeckWord[];
    };
    for (const word of data.words ?? []) {
      words.push(word);
    }
  }
  return dedupeWords(words);
};
