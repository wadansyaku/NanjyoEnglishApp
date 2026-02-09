export type TestWord = {
  headwordNorm: string;
  headword: string;
  meaningJa: string;
};

export type TestMode = 'choice' | 'typing' | 'reverse' | 'mixed';

export type TestQuestionType = 'choice' | 'typing' | 'reverse';

export type TestQuestion = {
  id: string;
  type: TestQuestionType;
  prompt: string;
  answer: string;
  choices: string[];
  source: TestWord;
};

const normalizeAnswer = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[^a-z'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const uniqWords = (words: TestWord[]) => {
  const map = new Map<string, TestWord>();
  for (const word of words) {
    const key = word.headwordNorm || normalizeAnswer(word.headword);
    if (!key) continue;
    if (!word.meaningJa.trim()) continue;
    if (!map.has(key)) {
      map.set(key, {
        headwordNorm: key,
        headword: word.headword.trim(),
        meaningJa: word.meaningJa.trim()
      });
    }
  }
  return [...map.values()];
};

const shuffle = <T,>(source: T[]) => {
  const list = [...source];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  return list;
};

const pickWrongMeanings = (pool: TestWord[], currentNorm: string, count: number) => {
  const candidates = shuffle(pool.filter((word) => word.headwordNorm !== currentNorm));
  return candidates.slice(0, count).map((word) => word.meaningJa);
};

const pickWrongHeadwords = (pool: TestWord[], currentNorm: string, count: number) => {
  const candidates = shuffle(pool.filter((word) => word.headwordNorm !== currentNorm));
  return candidates.slice(0, count).map((word) => word.headword);
};

export const isTypingCorrect = (answer: string, expected: string) =>
  normalizeAnswer(answer) === normalizeAnswer(expected);

export const buildQuestions = (
  words: TestWord[],
  input: {
    count: number;
    mode: TestMode;
  }
): TestQuestion[] => {
  const pool = uniqWords(words);
  if (pool.length === 0) return [];

  const count = Math.max(1, Math.min(input.count, pool.length));
  const selected = shuffle(pool).slice(0, count);
  const questions: TestQuestion[] = [];

  for (let i = 0; i < selected.length; i += 1) {
    const word = selected[i];
    const mode =
      input.mode === 'mixed'
        ? (i % 3 === 0 ? 'reverse' : i % 2 === 0 ? 'typing' : 'choice')
        : input.mode;

    if (mode === 'choice') {
      const wrong = pickWrongMeanings(pool, word.headwordNorm, 3);
      questions.push({
        id: `${word.headwordNorm}-choice-${i}`,
        type: 'choice',
        prompt: word.headword,
        answer: word.meaningJa,
        choices: shuffle([word.meaningJa, ...wrong]),
        source: word
      });
      continue;
    }

    if (mode === 'reverse') {
      const wrong = pickWrongHeadwords(pool, word.headwordNorm, 3);
      questions.push({
        id: `${word.headwordNorm}-reverse-${i}`,
        type: 'reverse',
        prompt: word.meaningJa,
        answer: word.headword,
        choices: shuffle([word.headword, ...wrong]),
        source: word
      });
      continue;
    }

    questions.push({
      id: `${word.headwordNorm}-typing-${i}`,
      type: 'typing',
      prompt: word.meaningJa,
      answer: word.headword,
      choices: [],
      source: word
    });
  }

  return questions;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildPrintableTestHtml = (
  title: string,
  questions: TestQuestion[],
  options: {
    subtitle?: string;
    modeLabel?: string;
  } = {}
) => {
  const subtitle = options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : '';
  const modeLabel = options.modeLabel ? `方式: ${escapeHtml(options.modeLabel)}` : '';

  const questionHtml = questions
    .map((question, index) => {
      const choices =
        question.choices.length > 0
          ? `<ul>${question.choices.map((choice) => `<li>${escapeHtml(choice)}</li>`).join('')}</ul>`
          : '<div class="line"></div>';
      return `<article class="q">
        <h3>Q${index + 1}. ${escapeHtml(question.prompt)}</h3>
        ${choices}
      </article>`;
    })
    .join('');

  const answerHtml = questions
    .map(
      (question, index) =>
        `<li><strong>Q${index + 1}</strong> ${escapeHtml(question.prompt)} → ${escapeHtml(question.answer)}</li>`
    )
    .join('');

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
        margin: 20px;
        color: #222;
      }
      h1, h2, h3 { margin: 0; }
      .meta { margin: 8px 0 20px; color: #555; }
      .q {
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 10px;
      }
      ul { margin: 8px 0 0 18px; padding: 0; }
      li { margin: 4px 0; }
      .line {
        margin-top: 10px;
        border-bottom: 1px solid #999;
        height: 24px;
      }
      .answers {
        page-break-before: always;
      }
      @media print {
        body { margin: 10mm; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        ${subtitle}
        <p>${escapeHtml(modeLabel)} / 問題数: ${questions.length}</p>
      </div>
    </header>
    <main>${questionHtml}</main>
    <section class="answers">
      <h2>解答</h2>
      <ol>${answerHtml}</ol>
    </section>
  </body>
</html>`;
};
