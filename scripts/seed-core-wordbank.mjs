#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const SOURCE_TAG = 'ORIGINAL_WORDBANK_20260208';
const DEFAULT_CSV_PATH = path.resolve(
  process.cwd(),
  'docs/wordbank_pos_audit/20260208_225334/ORIGINAL_WORDBANK_JHS_HS_FINAL_CONFIRMED.csv'
);
const DEFAULT_DATABASE_NAME = 'nanjyo_lexicon';

const usage = () => {
  console.log(`Usage:
  node scripts/seed-core-wordbank.mjs [options]

Options:
  --csv <path>         CSV path (default: ${DEFAULT_CSV_PATH})
  --database <name>    Wrangler D1 database name (default: ${DEFAULT_DATABASE_NAME})
  --remote             Seed remote database (default: local)
  --dry-run            Parse only, no DB writes
  --out-dir <path>     Write generated SQL files to this directory
  --help               Show this help
`);
};

const parseArgs = (argv) => {
  const options = {
    csvPath: DEFAULT_CSV_PATH,
    database: DEFAULT_DATABASE_NAME,
    remote: false,
    dryRun: false,
    outDir: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--csv') {
      options.csvPath = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : '';
      i += 1;
      continue;
    }
    if (arg === '--database') {
      options.database = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg === '--remote') {
      options.remote = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--out-dir') {
      options.outDir = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : '';
      i += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.csvPath) {
    throw new Error('--csv must be a valid path.');
  }
  if (!options.database) {
    throw new Error('--database must not be empty.');
  }
  return options;
};

const sanitizeSingleLine = (value) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hasNewline = (value) => /[\r\n]/.test(value);

const toPositiveInt = (value, fallback = 9999) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
};

const toDeckIdPart = (value) =>
  sanitizeSingleLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const sqlString = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sqlNullable = (value) => (value == null || value === '' ? 'NULL' : sqlString(value));

const normalizeHeadword = (value, options = {}) => {
  const stripPossessive = options.stripPossessive ?? true;
  const lowered = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[’‘`´]/g, "'");
  if (!lowered) return '';

  const cleaned = lowered.replace(/[^a-z'\s-]/g, ' ').replace(/\s+/g, ' ');
  const rawTokens = cleaned
    .split(/[\s-]+/)
    .map((token) => token.replace(/^'+|'+$/g, ''))
    .filter(Boolean);

  const tokens = rawTokens
    .map((token) => {
      if (!stripPossessive || token.length <= 2) return token;
      return token.replace(/'s$/, '');
    })
    .filter((token) => token.length > 0);

  return tokens.join('');
};

const parseCsvLine = (line) => {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
};

const readCsvRows = (csvPath) => {
  const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length < 2) {
    throw new Error('CSV must include header and at least one row.');
  }

  const header = parseCsvLine(lines[0]).map((field) => field.toLowerCase());
  const indexOf = (name) => header.indexOf(name.toLowerCase());
  const getValue = (row, name) => {
    const idx = indexOf(name);
    if (idx < 0) return '';
    return row[idx] ?? '';
  };

  if (indexOf('headword') < 0 || indexOf('meaning_ja_short') < 0) {
    throw new Error('CSV header must include headword and meaning_ja_short.');
  }

  const wordsMap = new Map();
  const collisions = [];
  const decks = new Map();

  const isLikelyPhrase = (posValue, isPhraseRaw) => {
    const pos = sanitizeSingleLine(posValue).toLowerCase();
    if (pos === 'phrase') return true;
    const raw = sanitizeSingleLine(isPhraseRaw).toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  };

  const separatorCount = (value) => {
    const text = sanitizeSingleLine(value);
    const matches = text.match(/[\s-]/g);
    return matches ? matches.length : 0;
  };

  const shouldReplaceCollision = (current, next) => {
    if (next.separatorPenalty !== current.separatorPenalty) {
      return next.separatorPenalty < current.separatorPenalty;
    }
    if (next.phrasePenalty !== current.phrasePenalty) {
      return next.phrasePenalty < current.phrasePenalty;
    }
    if (next.curriculumOrder !== current.curriculumOrder) {
      return next.curriculumOrder < current.curriculumOrder;
    }
    if (next.headword.length !== current.headword.length) {
      return next.headword.length < current.headword.length;
    }
    return next.headword.localeCompare(current.headword) < 0;
  };

  const ensureDeck = (deckId, title, description, source) => {
    const existing = decks.get(deckId);
    if (existing) return existing;
    const created = {
      deckId,
      title,
      description,
      source,
      entries: []
    };
    decks.set(deckId, created);
    return created;
  };

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);

    const headwordRaw = sanitizeSingleLine(getValue(row, 'headword')).slice(0, 64);
    const normRaw = sanitizeSingleLine(getValue(row, 'headword_norm'));
    const headwordNorm = normalizeHeadword(normRaw || headwordRaw);
    const meaningJaShort = sanitizeSingleLine(getValue(row, 'meaning_ja_short'));
    const pos = sanitizeSingleLine(getValue(row, 'pos')).slice(0, 32);
    const stageLabel = sanitizeSingleLine(getValue(row, 'stage_label'));
    const defaultLabel = sanitizeSingleLine(getValue(row, 'grade_bucket_default_label'));
    const standardLabel = sanitizeSingleLine(getValue(row, 'grade_bucket_standard_label'));
    const level = (defaultLabel || stageLabel || standardLabel).slice(0, 32);
    const sourcePrimary = sanitizeSingleLine(getValue(row, 'source_primary'));
    const source = (sourcePrimary || SOURCE_TAG).slice(0, 40);
    const sourceCount = toPositiveInt(getValue(row, 'source_count'), 0);
    const sourceNumberMedian = toPositiveInt(getValue(row, 'source_number_median'), 9999);
    const sourceNumberMin = toPositiveInt(getValue(row, 'source_number_min'), 9999);
    const bookRankPrimary = toPositiveInt(getValue(row, 'book_rank_primary'), 9999);

    if (!headwordNorm || !headwordRaw || !meaningJaShort) continue;
    if (hasNewline(meaningJaShort)) {
      throw new Error(`Invalid meaning with newline at row ${i + 1}: ${headwordRaw}`);
    }
    if (meaningJaShort.length > 80) {
      throw new Error(`meaning_ja_short exceeds 80 chars at row ${i + 1}: ${headwordRaw}`);
    }

    const phrase = isLikelyPhrase(getValue(row, 'pos'), getValue(row, 'is_phrase'));

    const tags = {
      posLabelJa: sanitizeSingleLine(getValue(row, 'pos_label_ja')),
      stage: sanitizeSingleLine(getValue(row, 'stage')),
      stageLabel,
      isPhrase: phrase,
      gradeDefaultId: sanitizeSingleLine(getValue(row, 'grade_bucket_default_id')),
      gradeDefaultLabel: defaultLabel,
      gradeStandardId: sanitizeSingleLine(getValue(row, 'grade_bucket_standard_id')),
      gradeStandardLabel: standardLabel,
      groupId: sanitizeSingleLine(getValue(row, 'group_id')),
      groupLabel: sanitizeSingleLine(getValue(row, 'group_label')),
      sourceCount,
      sourceNumberMedian,
      sourceNumberMin,
      bookRankPrimary
    };
    const tagsJson = JSON.stringify(tags);

    const candidate = {
      headword: headwordRaw,
      headwordNorm,
      meaningJaShort,
      pos,
      level,
      tagsJson,
      source,
      phrasePenalty: phrase ? 1 : 0,
      separatorPenalty: separatorCount(normRaw || headwordRaw),
      curriculumOrder: Math.min(
        toPositiveInt(getValue(row, 'grade_bucket_default_order'), 9999),
        toPositiveInt(getValue(row, 'grade_bucket_standard_order'), 9999)
      )
    };

    const existing = wordsMap.get(headwordNorm);
    if (!existing) {
      wordsMap.set(headwordNorm, candidate);
    } else if (shouldReplaceCollision(existing, candidate)) {
      collisions.push({
        headwordNorm,
        keptHeadword: candidate.headword,
        keptPos: candidate.pos,
        droppedHeadword: existing.headword,
        droppedPos: existing.pos
      });
      wordsMap.set(headwordNorm, candidate);
    } else {
      collisions.push({
        headwordNorm,
        keptHeadword: existing.headword,
        keptPos: existing.pos,
        droppedHeadword: candidate.headword,
        droppedPos: candidate.pos
      });
    }

    const defaultId = sanitizeSingleLine(getValue(row, 'grade_bucket_default_id'));
    const standardId = sanitizeSingleLine(getValue(row, 'grade_bucket_standard_id'));
    const defaultOrder = toPositiveInt(getValue(row, 'grade_bucket_default_order'), 9999);
    const standardOrder = toPositiveInt(getValue(row, 'grade_bucket_standard_order'), 9999);
    const groupOrder = toPositiveInt(getValue(row, 'group_order'), 9999);

    const allDeck = ensureDeck(
      'all_jhs_hs',
      '中高一貫 単語帳（全範囲）',
      '中学1年〜高校レベルまでを一括学習できる全範囲デッキ',
      `${SOURCE_TAG}:all`
    );
    allDeck.entries.push({
      headwordNorm,
      sortA: defaultOrder,
      sortB: groupOrder,
      sortC: -sourceCount,
      sortD: sourceNumberMedian,
      sortE: bookRankPrimary,
      sortF: headwordRaw.length,
      sortG: headwordRaw
    });

    if (defaultId && defaultLabel) {
      const deckId = `default_${toDeckIdPart(defaultId)}`;
      const deck = ensureDeck(
        deckId,
        `${defaultLabel}（速習）`,
        `速習カリキュラム: ${defaultLabel}`,
        `${SOURCE_TAG}:default`
      );
      deck.entries.push({
        headwordNorm,
        sortA: defaultOrder,
        sortB: groupOrder,
        sortC: -sourceCount,
        sortD: sourceNumberMedian,
        sortE: bookRankPrimary,
        sortF: headwordRaw.length,
        sortG: headwordRaw
      });
    }

    if (standardId && standardLabel) {
      const deckId = `standard_${toDeckIdPart(standardId)}`;
      const deck = ensureDeck(
        deckId,
        `${standardLabel}`,
        `標準カリキュラム: ${standardLabel}`,
        `${SOURCE_TAG}:standard`
      );
      deck.entries.push({
        headwordNorm,
        sortA: standardOrder,
        sortB: groupOrder,
        sortC: -sourceCount,
        sortD: sourceNumberMedian,
        sortE: bookRankPrimary,
        sortF: headwordRaw.length,
        sortG: headwordRaw
      });
    }
  }

  const words = [...wordsMap.values()]
    .map((word) => ({
      headword: word.headword,
      headwordNorm: word.headwordNorm,
      meaningJaShort: word.meaningJaShort,
      pos: word.pos,
      level: word.level,
      tagsJson: word.tagsJson,
      source: word.source
    }))
    .sort((a, b) => a.headwordNorm.localeCompare(b.headwordNorm));
  const deckList = [...decks.values()]
    .map((deck) => {
      const unique = new Map();
      for (const entry of deck.entries) {
        unique.set(entry.headwordNorm, entry);
      }
      const entries = [...unique.values()].sort((a, b) => {
        if (a.sortA !== b.sortA) return a.sortA - b.sortA;
        if (a.sortB !== b.sortB) return a.sortB - b.sortB;
        if (a.sortC !== b.sortC) return a.sortC - b.sortC;
        if (a.sortD !== b.sortD) return a.sortD - b.sortD;
        if (a.sortE !== b.sortE) return a.sortE - b.sortE;
        if (a.sortF !== b.sortF) return a.sortF - b.sortF;
        return a.sortG.localeCompare(b.sortG);
      });
      return {
        deckId: deck.deckId,
        title: deck.title,
        description: deck.description,
        source: deck.source,
        entries
      };
    })
    .sort((a, b) => a.deckId.localeCompare(b.deckId));

  return { words, decks: deckList, collisions };
};

const wordIdFromNorm = (headwordNorm) =>
  `core_${createHash('sha1').update(headwordNorm).digest('hex')}`;

const buildWordStatements = (words, now) =>
  words.map((word) => {
    const wordId = wordIdFromNorm(word.headwordNorm);
    return `INSERT INTO core_words
      (word_id, headword, headword_norm, meaning_ja_short, pos, level, tags_json, source, created_at, updated_at)
      VALUES (
        ${sqlString(wordId)},
        ${sqlString(word.headword)},
        ${sqlString(word.headwordNorm)},
        ${sqlString(word.meaningJaShort)},
        ${sqlNullable(word.pos)},
        ${sqlNullable(word.level)},
        ${sqlNullable(word.tagsJson)},
        ${sqlNullable(word.source)},
        ${now},
        ${now}
      )
      ON CONFLICT(headword_norm) DO UPDATE SET
        headword = excluded.headword,
        meaning_ja_short = excluded.meaning_ja_short,
        pos = excluded.pos,
        level = excluded.level,
        tags_json = excluded.tags_json,
        source = excluded.source,
        updated_at = excluded.updated_at`;
  });

const buildDeckStatements = (decks, now) =>
  decks.map(
    (deck) => `INSERT INTO core_decks (deck_id, title, description, source, created_at)
      VALUES (
        ${sqlString(deck.deckId)},
        ${sqlString(deck.title)},
        ${sqlNullable(deck.description)},
        ${sqlNullable(deck.source)},
        ${now}
      )
      ON CONFLICT(deck_id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        source = excluded.source`
  );

const buildDeckWordStatements = (deck) => {
  const statements = [`DELETE FROM core_deck_words WHERE deck_id = ${sqlString(deck.deckId)}`];
  for (let i = 0; i < deck.entries.length; i += 1) {
    const entry = deck.entries[i];
    statements.push(`INSERT OR IGNORE INTO core_deck_words (deck_id, word_id, order_index)
      SELECT ${sqlString(deck.deckId)}, word_id, ${i}
      FROM core_words
      WHERE headword_norm = ${sqlString(entry.headwordNorm)}`);
  }
  return statements;
};

const renderSql = (statements) => `${statements.join(';\n')};\n`;

const runSqlFile = ({ label, sql, options }) => {
  const outDir = options.outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'wordbank-seed-'));
  fs.mkdirSync(outDir, { recursive: true });
  const sqlPath = path.join(outDir, `${label}.sql`);
  fs.writeFileSync(sqlPath, sql, 'utf8');

  if (options.dryRun) {
    return { sqlPath, ran: false };
  }

  const args = ['wrangler', 'd1', 'execute', options.database];
  if (options.remote) args.push('--remote');
  args.push('--file', sqlPath);
  const result = spawnSync('npx', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Failed to execute ${label}.sql`);
  }
  const summaryMatch = (result.stdout ?? '').match(/🚣\s+([0-9,]+)\s+commands executed successfully\./);
  if (summaryMatch) {
    console.log(`${label}: ${summaryMatch[1]} commands applied`);
  } else {
    console.log(`${label}: applied`);
  }
  return { sqlPath, ran: true };
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.csvPath)) {
    throw new Error(`CSV file not found: ${options.csvPath}`);
  }

  const { words, decks, collisions } = readCsvRows(options.csvPath);
  if (words.length === 0) {
    throw new Error('No valid words were parsed.');
  }
  if (decks.length === 0) {
    throw new Error('No decks were generated.');
  }

  console.log(`Parsed words: ${words.length}`);
  console.log(`Generated decks: ${decks.length}`);
  console.log(`Normalization collisions handled: ${collisions.length}`);
  for (const deck of decks) {
    console.log(`  - ${deck.deckId}: ${deck.entries.length}`);
  }

  if (collisions.length > 0 && options.outDir) {
    fs.mkdirSync(options.outDir, { recursive: true });
    const collisionPath = path.join(options.outDir, 'headword_norm_collisions.csv');
    const lines = ['headword_norm,kept_headword,kept_pos,dropped_headword,dropped_pos'];
    for (const item of collisions) {
      lines.push(
        [
          item.headwordNorm,
          item.keptHeadword,
          item.keptPos,
          item.droppedHeadword,
          item.droppedPos
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(',')
      );
    }
    fs.writeFileSync(collisionPath, `${lines.join('\n')}\n`, 'utf8');
    console.log(`Collision report: ${collisionPath}`);
  }

  const now = Date.now();
  const wordSql = renderSql(buildWordStatements(words, now));
  runSqlFile({ label: '01_core_words_upsert', sql: wordSql, options });

  const deckSql = renderSql(buildDeckStatements(decks, now));
  runSqlFile({ label: '02_core_decks_upsert', sql: deckSql, options });

  for (const deck of decks) {
    const deckWordSql = renderSql(buildDeckWordStatements(deck));
    runSqlFile({
      label: `03_core_deck_words_${deck.deckId}`,
      sql: deckWordSql,
      options
    });
  }

  if (options.dryRun) {
    console.log('Dry run completed. SQL files were generated only.');
  } else {
    console.log('Wordbank seed completed.');
    console.log(`Database: ${options.database} (${options.remote ? 'remote' : 'local'})`);
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
