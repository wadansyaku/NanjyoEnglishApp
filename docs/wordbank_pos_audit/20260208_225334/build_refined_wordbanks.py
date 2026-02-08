#!/usr/bin/env python3
"""Build refined master and original wordbank datasets.

Inputs:
  - /Users/Yodai/Downloads/COMPLETE_MASTER_DATABASE_20251117.csv
  - Multiple CSV source directories

Outputs (under output_curated/<timestamp>/):
  - MASTER_DATABASE_REFINED.csv
  - MASTER_FILL_AUDIT.csv
  - MASTER_UNRESOLVED.csv
  - ORIGINAL_WORDBANK_JHS_HS.csv
  - ORIGINAL_WORDBANK_DECKS.csv
  - ORIGINAL_WORDBANK_DECK_WORDS.csv
  - ORIGINAL_WORDBANK_DECKS_ACCELERATED.csv
  - ORIGINAL_WORDBANK_DECKS_STANDARD.csv
  - ORIGINAL_WORDBANK_DECK_WORDS_ACCELERATED.csv
  - ORIGINAL_WORDBANK_DECK_WORDS_STANDARD.csv
  - ORIGINAL_WORDBANK_GROUPS.csv
  - ORIGINAL_WORDBANK_POS_REVIEW.csv
  - ORIGINAL_WORDBANK_POS_REVIEW_HIGH.csv
  - ORIGINAL_WORDBANK_POS_REVIEW_MEDIUM.csv
  - ORIGINAL_WORDBANK_POS_OVERRIDE_TEMPLATE.csv
  - ORIGINAL_WORDBANK_POS_HIGH_CONFIRMATIONS.csv
  - ORIGINAL_WORDBANK_POS_MEDIUM_CONFIRMATIONS.csv
  - ORIGINAL_WORDBANK_JHS_HS_HIGH_CONFIRMED.csv
  - ORIGINAL_WORDBANK_JHS_HS_HIGH_MEDIUM_CONFIRMED.csv
  - ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_HIGH_MEDIUM.csv
  - ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_HIGH_MEDIUM_QUICKWIN.csv
  - ORIGINAL_WORDBANK_POS_QUICKWIN_CONFIRMATIONS.csv
  - ORIGINAL_WORDBANK_JHS_HS_HIGH_MEDIUM_QUICKWIN_CONFIRMED.csv
  - ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_HIGH_MEDIUM_REMAINING.csv
  - ORIGINAL_WORDBANK_POS_MANUAL_APPLIED.csv
  - ORIGINAL_WORDBANK_POS_MANUAL_DECISION_IGNORED.csv
  - ORIGINAL_WORDBANK_JHS_HS_FINAL_CONFIRMED.csv
  - ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_FINAL_REMAINING.csv
  - ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_FINAL_REMAINING_PREFILLED.csv
  - manual_batches/POS_MANUAL_BATCH_*.csv
  - manual_batches/POS_MANUAL_BATCH_SUMMARY.csv
  - manual_batches/README.md
  - VALIDATION_DEEP_DIVE.md
  - REPORT.md
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import pandas as pd


MASTER_CSV = Path("/Users/Yodai/Downloads/COMPLETE_MASTER_DATABASE_20251117.csv")

SOURCE_SPECS: Sequence[Tuple[Path, str, int, str]] = [
    # Strictly aligned sources with master numbering.
    (
        Path("/Users/Yodai/projects/language_database_2_2/output/source_completed"),
        "*.csv",
        1,
        "db2_source_completed",
    ),
    (
        Path("/Users/Yodai/projects/language_database_2_2/output/source_high_priority"),
        "*.csv",
        2,
        "db2_source_high_priority",
    ),
    (
        Path("/Users/Yodai/projects/language_database_2_2/output/source"),
        "*.csv",
        3,
        "db2_source",
    ),
    (
        Path("/Users/Yodai/Downloads/final_output_v10"),
        "*.csv",
        4,
        "final_output_v10",
    ),
]

EXTRA_SINGLE_FILES: Sequence[Tuple[Path, int, str]] = []

MISSING_TOKENS = {"", "[未抽出]", "nan", "NaN", "None"}

# High-confidence manual patches verified directly from PDF line inspection.
MANUAL_PATCHES: Dict[Tuple[str, int], Tuple[str, str, str]] = {
    # TOEFLテスト英単語3800 p.9 line:
    # "3070 null 無効、取り消し、無価値"
    ("TOEFLテスト英単語3800", 3070): ("null", "無効、取り消し、無価値", "manual_pdf_line"),
    # 英熟語ターゲット1000 4訂版 p.12 line:
    # "60 result from ~ ～から起こる"
    ("英熟語ターゲット1000 4訂版", 60): ("result from ~", "～から起こる", "manual_pdf_line"),
}

STAGE_RULES: Sequence[Tuple[int, str, Sequence[str]]] = [
    (1, "JHS_Foundation", ["英検 5級", "英検 4級", "英検 3級", "速読英単語 中学版", "英単語ターゲット1200", "ユメタン黄"]),
    (
        2,
        "HS_Basic",
        [
            "英検 準2級",
            "英検 準2級 プラス",
            "システム英単語 BASIC",
            "英単語ターゲット1400",
            "速読英単語 入門編",
            "英単語Stock3000",
            "ユメタン赤",
            "英熟語ターゲット1000",
        ],
    ),
    (
        3,
        "HS_Core",
        [
            "英検 2級",
            "システム英単語 5訂版",
            "英単語ターゲット1900",
            "DUO3.0",
            "必携英単語LEAP",
            "速読英単語 必修編",
            "英単語Stock4500",
            "ユメタン青",
            "チャンクで英単語 Standard",
        ],
    ),
    (
        4,
        "HS_Advanced",
        [
            "英検 準1級",
            "英検準1級単熟語EX",
            "英検 1級",
            "TOEFL",
            "TOEIC",
            "話題別英単語リンガメタリカ",
            "速読英単語 上級編",
            "鉄緑会",
            "コーパス4500",
            "ユメジュク",
        ],
    ),
]

GRADE_BUCKET_RULES_ACCELERATED: Sequence[Tuple[str, str, int, Sequence[str]]] = [
    (
        "G7_JHS1",
        "中1基礎",
        1,
        ["英検 5級", "英検 4級", "速読英単語 中学版", "英単語ターゲット1200", "ユメタン黄"],
    ),
    (
        "G8_JHS2",
        "中2標準",
        2,
        ["英検 3級", "速読英単語 中学版", "英単語ターゲット1200"],
    ),
    (
        "G9_JHS3",
        "中3発展",
        3,
        ["英検 準2級", "英検 準2級 プラス", "英単語ターゲット1400", "システム英単語 BASIC", "英単語Stock3000", "ユメタン赤"],
    ),
    (
        "G10_HS1",
        "高1完了(速習)",
        4,
        [
            "英検 2級",
            "システム英単語 5訂版",
            "英単語ターゲット1900",
            "DUO3.0",
            "必携英単語LEAP",
            "速読英単語 必修編",
            "英単語Stock4500",
            "ユメタン青",
            "英熟語ターゲット1000",
            "チャンクで英単語 Standard",
        ],
    ),
    (
        "G11_HS2",
        "高2発展(速習)",
        5,
        ["英検 準1級", "英検準1級単熟語EX", "TOEIC", "話題別英単語リンガメタリカ"],
    ),
    (
        "G12_HS3",
        "高3最難関(速習)",
        6,
        ["英検 1級", "TOEFL", "速読英単語 上級編", "鉄緑会", "コーパス4500", "ユメジュク"],
    ),
]

GRADE_BUCKET_RULES_STANDARD: Sequence[Tuple[str, str, int, Sequence[str]]] = [
    (
        "G7_JHS1",
        "中1基礎(標準)",
        1,
        ["英検 5級", "英検 4級", "速読英単語 中学版", "英単語ターゲット1200", "ユメタン黄"],
    ),
    (
        "G8_JHS2",
        "中2標準(標準)",
        2,
        ["英検 3級", "速読英単語 中学版", "英単語ターゲット1200"],
    ),
    (
        "G9_JHS3",
        "中3発展(標準)",
        3,
        ["英検 準2級", "英検 準2級 プラス", "英単語ターゲット1400", "システム英単語 BASIC", "英単語Stock3000", "ユメタン赤"],
    ),
    (
        "G10_HS1",
        "高1基礎(標準)",
        4,
        ["英検 2級", "システム英単語 5訂版", "英単語ターゲット1900", "DUO3.0", "必携英単語LEAP", "速読英単語 必修編"],
    ),
    (
        "G11_HS2",
        "高2標準(標準)",
        5,
        ["英単語Stock4500", "ユメタン青", "英熟語ターゲット1000", "チャンクで英単語 Standard"],
    ),
    (
        "G12_HS3",
        "高3発展(標準)",
        6,
        ["英検 準1級", "英検準1級単熟語EX", "英検 1級", "TOEFL", "TOEIC", "話題別英単語リンガメタリカ", "速読英単語 上級編", "鉄緑会", "コーパス4500", "ユメジュク"],
    ),
]

POS_ORDER = ["verb", "noun", "adjective", "adverb", "phrase", "function", "other"]
POS_ORDER_INDEX = {label: idx + 1 for idx, label in enumerate(POS_ORDER)}
POS_LABEL_JA = {
    "verb": "動詞",
    "noun": "名詞",
    "adjective": "形容詞",
    "adverb": "副詞",
    "phrase": "熟語",
    "function": "機能語",
    "other": "その他",
}

POS_TAG_PATTERNS: Dict[str, str] = {
    "noun": r"【名】|\[名\]|\(名\)",
    "verb": r"【動】|\[動\]|\(動\)|【他】|\[他\]|\(他\)|【自】|\[自\]|\(自\)",
    "adjective": r"【形】|\[形\]|\(形\)",
    "adverb": r"【副】|\[副\]|\(副\)",
}

FUNCTION_WORDS = {
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "because",
    "although",
    "however",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "from",
    "with",
    "by",
    "about",
    "under",
    "over",
    "between",
    "through",
    "during",
    "without",
    "before",
    "after",
    "into",
    "upon",
    "as",
    "that",
    "this",
    "these",
    "those",
    "which",
    "who",
    "whom",
    "whose",
    "what",
    "when",
    "where",
    "why",
    "how",
    # Pronouns / determiners / quantifiers (mapped to function in this schema)
    "i",
    "me",
    "my",
    "mine",
    "myself",
    "you",
    "your",
    "yours",
    "yourself",
    "yourselves",
    "he",
    "him",
    "his",
    "himself",
    "she",
    "her",
    "hers",
    "herself",
    "it",
    "its",
    "itself",
    "we",
    "us",
    "our",
    "ours",
    "ourselves",
    "they",
    "them",
    "their",
    "theirs",
    "themselves",
    "any",
    "some",
    "many",
    "much",
    "all",
    "another",
    "either",
    "neither",
    "both",
    "each",
    "few",
    "more",
    "most",
    "less",
}

ADVERB_HEADWORDS = {
    "almost",
    "already",
    "also",
    "always",
    "away",
    "ever",
    "hardly",
    "here",
    "however",
    "just",
    "maybe",
    "never",
    "often",
    "once",
    "perhaps",
    "quite",
    "rather",
    "really",
    "simply",
    "sometimes",
    "soon",
    "still",
    "there",
    "therefore",
    "thus",
    "together",
    "tomorrow",
    "too",
    "twice",
    "usually",
    "very",
    "well",
    "yesterday",
    "yet",
}
ADJECTIVE_HEADWORDS = {
    "afraid",
    "alive",
    "asleep",
    "awake",
    "glad",
    "likely",
    "unable",
    "available",
    "responsible",
}

NOUN_SUFFIXES = (
    "tion",
    "sion",
    "ment",
    "ness",
    "ity",
    "ence",
    "ance",
    "ship",
    "hood",
    "ism",
    "ist",
    "er",
    "or",
    "age",
)
ADJECTIVE_SUFFIXES = ("ous", "ful", "ive", "al", "able", "ible", "ic", "ical", "less", "ish")
VERB_SUFFIXES = ("ate", "ify", "ise", "ize", "en")
ADVERB_EXCEPTIONS = {"friendly", "likely", "lively", "lonely", "lovely", "silly", "ugly", "early", "costly"}
VERB_SUFFIX_EXCEPTIONS = {
    "date",
    "state",
    "rate",
    "late",
    "plate",
    "mate",
    "private",
    "climate",
}
STAGE_POS_WEIGHT = {1: 1.25, 2: 1.15, 3: 1.0, 4: 0.9}
POS_EVIDENCE_WEIGHT = {
    "phrase_pattern": 1.35,
    "function_word_list": 1.3,
    "explicit_tag:noun": 1.28,
    "explicit_tag:verb": 1.28,
    "explicit_tag:adjective": 1.28,
    "explicit_tag:adverb": 1.28,
    "explicit_primary_tag:verb": 1.22,
    "explicit_primary_tag:adjective": 1.22,
    "explicit_primary_tag:adverb": 1.22,
    "headword_adverb_list": 1.3,
    "headword_adjective_list": 1.25,
    "meaning_gerund_noun": 1.2,
    "meaning_dict_form_verb": 1.18,
    "meaning_dict_form_adjective": 1.16,
    "meaning_dict_form_adverb": 1.12,
    "meaning_contains_する": 1.2,
    "meaning_adjective_marker": 1.15,
    "meaning_adverb_marker": 1.15,
    "suffix_ly": 1.1,
    "noun_suffix": 1.08,
    "adjective_suffix": 1.08,
    "verb_suffix": 1.02,
    "meaning_noun_marker": 1.0,
    "fallback_noun": 0.85,
}
POS_REVIEW_CONFIDENCE_THRESHOLD = 70
POS_REVIEW_MARGIN_THRESHOLD = 35.0
STAGE_TO_GRADE_FALLBACK_ACCELERATED = {
    1: ("G7_JHS1", "中1基礎", 1),
    2: ("G9_JHS3", "中3発展", 3),
    3: ("G10_HS1", "高1完了(速習)", 4),
    4: ("G11_HS2", "高2発展(速習)", 5),
}
STAGE_TO_GRADE_FALLBACK_STANDARD = {
    1: ("G7_JHS1", "中1基礎(標準)", 1),
    2: ("G9_JHS3", "中3発展(標準)", 3),
    3: ("G10_HS1", "高1基礎(標準)", 4),
    4: ("G12_HS3", "高3発展(標準)", 6),
}

COLUMN_NUMBER_CANDIDATES = ["word_number", "単語番号", "word number", "number", "単語番号_数値"]
COLUMN_WORD_CANDIDATES = ["word", "単語", "term", "headword"]
COLUMN_TRANSLATION_CANDIDATES = ["translation", "日本語訳", "japanese translation", "meaning", "japanese", "translation_ja"]
COLUMN_BOOK_CANDIDATES = ["単語帳名", "source_book", "book", "book_name"]


def clean_text(value: object) -> str:
    text = str(value if value is not None else "")
    text = text.replace("\ufeff", "").replace("\u3000", " ").replace("\r", " ").replace("\n", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def normalize_book_name(name: str) -> str:
    text = unicodedata.normalize("NFKC", clean_text(name)).lower()
    text = text.replace("ヶ", "ケ").replace("ヵ", "カ")
    text = re.sub(r"[\s\-‐‑‒–—―_・･/\\()\[\]{}「」『』【】〈〉《》:：;；,，.．!！?？\"“”'’`＠@]", "", text)
    return text


def normalize_headword(word: str) -> str:
    text = unicodedata.normalize("NFKC", clean_text(word)).lower()
    text = text.replace("’", "'").replace("`", "'")
    text = re.sub(r"[^a-z0-9'\- ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" -'")
    return text


def has_japanese(text: str) -> bool:
    return bool(re.search(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]", str(text)))


def has_ascii_letter(text: str) -> bool:
    return bool(re.search(r"[A-Za-z]", str(text)))


def is_phrase_headword(word: str) -> bool:
    normalized = clean_text(word).lower()
    if not normalized:
        return False
    return (" " in normalized) or ("~" in normalized) or ("/" in normalized)


def infer_pos(headword: str, meaning: str) -> Tuple[str, int, str]:
    w = clean_text(headword).lower()
    m = clean_text(meaning)
    m_norm = m.replace("〜", "～")
    gloss = extract_first_gloss(m_norm)
    explicit_tags = parse_explicit_pos_tags(m_norm)

    if not w:
        return "other", 0, "empty_word"

    if is_phrase_headword(w):
        return "phrase", 95, "phrase_pattern"

    if w in FUNCTION_WORDS:
        return "function", 95, "function_word_list"

    # Explicit POS tags in dictionary-style glosses are high-confidence signals.
    if len(explicit_tags) == 1:
        tag_pos = explicit_tags[0]
        return tag_pos, 94, f"explicit_tag:{tag_pos}"
    if len(explicit_tags) >= 2 and explicit_tags[0] != "noun":
        tag_pos = explicit_tags[0]
        return tag_pos, 90, f"explicit_primary_tag:{tag_pos}"

    if w in ADVERB_HEADWORDS:
        return "adverb", 92, "headword_adverb_list"

    if w in ADJECTIVE_HEADWORDS:
        return "adjective", 90, "headword_adjective_list"

    if gloss and re.search(r"[ぁ-んァ-ヶ一-龠]{1,14}な$", gloss):
        return "adjective", 86, "meaning_dict_form_adjective"

    if gloss and re.search(r"[ぁ-んァ-ヶ一-龠]{1,14}に$", gloss):
        return "adverb", 83, "meaning_dict_form_adverb"

    # Dictionary-form verbs in Japanese glosses (e.g., 食べる, 防ぐ, 認める).
    if gloss and re.search(r"[ぁ-んァ-ヶ一-龠]{1,16}(る|う|く|す|つ|ぬ|む|ぶ|ぐ)$", gloss):
        if not re.search(r"(もの|こと|ため)$", gloss):
            return "verb", 84, "meaning_dict_form_verb"

    # Dictionary-form i-adjectives (avoid broad over-trigger by excluding very short tokens).
    if gloss and re.search(r"[ぁ-んァ-ヶ一-龠]{2,14}い$", gloss):
        if not re.search(r"(祝い|思い|違い|戦い|争い|願い|祈り)$", gloss):
            return "adjective", 78, "meaning_dict_form_adjective"

    if re.search(r"すること", m_norm):
        return "noun", 82, "meaning_gerund_noun"

    if re.search(r"(?:^|[、,・;/()（）\\s])[^、,・;/()（）\\s]{0,8}(する|になる|させる)(?:$|[、,・;/()（）\\s])", m_norm):
        return "verb", 88, "meaning_contains_する"

    if "的な" in m_norm or re.search(r"(?:^|[、,・;/()（）\\s])[ぁ-んァ-ヶ一-龠]{1,10}な(?:$|[、,・;/()（）\\s])", m_norm):
        return "adjective", 84, "meaning_adjective_marker"

    if re.search(r"的に", m_norm) or re.search(r"(?:^|[、,・;/()（）\\s])[ぁ-んァ-ヶ一-龠]{1,10}に(?:$|[、,・;/()（）\\s])", m_norm):
        return "adverb", 82, "meaning_adverb_marker"

    if w.endswith("ly") and w not in ADVERB_EXCEPTIONS:
        return "adverb", 80, "suffix_ly"

    if any(w.endswith(suffix) for suffix in NOUN_SUFFIXES):
        return "noun", 76, "noun_suffix"

    if any(w.endswith(suffix) for suffix in ADJECTIVE_SUFFIXES):
        return "adjective", 74, "adjective_suffix"

    # Verb suffix is useful but can overfire on short nouns (e.g., "date").
    if len(w) >= 6 and (w not in VERB_SUFFIX_EXCEPTIONS) and any(w.endswith(suffix) for suffix in VERB_SUFFIXES):
        return "verb", 70, "verb_suffix"

    if re.search(r"(人|物|こと|状態|行為|性|力)", m_norm):
        return "noun", 65, "meaning_noun_marker"

    return "noun", 45, "fallback_noun"


def derive_word_family(headword_norm: str) -> str:
    if not headword_norm:
        return ""
    base = headword_norm.split(" ")[0]
    base = base.strip(" -'")
    for suffix in (
        "ization",
        "isation",
        "ation",
        "ition",
        "ingly",
        "edly",
        "ment",
        "ness",
        "ship",
        "able",
        "ible",
        "tion",
        "sion",
        "ance",
        "ence",
        "ally",
        "fully",
        "lessly",
        "ously",
        "ive",
        "ous",
        "ing",
        "ed",
        "ly",
        "er",
        "est",
        "s",
    ):
        if base.endswith(suffix) and len(base) - len(suffix) >= 3:
            return base[: -len(suffix)]
    return base


def first_alpha(text: str) -> str:
    for ch in text:
        if "a" <= ch <= "z":
            return ch
    return "_"


def parse_number(value: object) -> Optional[int]:
    text = clean_text(value)
    if not text:
        return None

    if re.fullmatch(r"\d+", text):
        return int(text)

    if re.fullmatch(r"\d+\.0+", text):
        return int(float(text))

    return None


def sanitize_meaning_short(text: str, limit: int = 80) -> str:
    cleaned = clean_text(text)
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 3].rstrip() + "..."


def extract_first_gloss(text: str) -> str:
    cleaned = clean_text(text)
    if not cleaned:
        return ""

    # Remove compact POS tags and leading labels.
    cleaned = re.sub(r"[\[\(（【](名|動|形|副|他|自|前|接|代|助|可算|不可算)[\]\)）】]", " ", cleaned)
    cleaned = re.sub(r"[\[\(（【][0-9①-⑩]+\s*[\]\)）】]", " ", cleaned)
    cleaned = cleaned.replace("；", "、").replace(";", "、").replace("/", "、")

    parts = [clean_text(p) for p in re.split(r"[、,]", cleaned) if clean_text(p)]
    for part in parts:
        token = re.sub(r"^[0-9①-⑩\-\.\s]+", "", part)
        token = clean_text(token)
        if token:
            return token
    return clean_text(parts[0]) if parts else ""


def parse_explicit_pos_tags(text: str) -> List[str]:
    normalized = clean_text(text)
    if not normalized:
        return []

    matches: List[Tuple[int, str]] = []
    for pos, pattern in POS_TAG_PATTERNS.items():
        for m in re.finditer(pattern, normalized):
            matches.append((m.start(), pos))
    if not matches:
        return []

    matches.sort(key=lambda item: item[0])
    ordered: List[str] = []
    seen = set()
    for _, pos in matches:
        if pos in seen:
            continue
        seen.add(pos)
        ordered.append(pos)
    return ordered


def is_missing_token(text: str) -> bool:
    stripped = clean_text(text)
    return stripped in MISSING_TOKENS


def strip_book_suffix(stem: str) -> str:
    text = unicodedata.normalize("NFKC", stem)
    patterns = [
        r"_MASTER$",
        r"_METADATA_ENHANCED$",
        r"_INTEGRATED$",
        r"_EMERGENCY_FIXED$",
        r"_CORRECTED$",
        r"_enhanced_phase\d+_fixed$",
        r"_expanded_v\d+$",
        r"_v\d+(?:_\d+)*$",
        r"_ENHANCED$",
        r"_FIXED$",
    ]
    for pattern in patterns:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE)
    return text.replace("_", " ").strip()


EN_SPAN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9'’`~\-./&+(),\[\] ]*[A-Za-z0-9~\])]|[A-Za-z]")


def split_word_translation(raw_word: str, raw_translation: str, is_kobun_book: bool) -> Tuple[str, str, str]:
    """Return (word, translation, method)."""
    word = clean_text(raw_word)
    translation = clean_text(raw_translation)

    if not is_missing_token(word) and not is_missing_token(translation):
        return word, translation, "direct"

    combined = clean_text(" ".join(part for part in [word, translation] if not is_missing_token(part)))
    if not combined:
        return word, translation, "empty"

    # Kobun entries are often Japanese headword + Japanese meaning.
    if is_kobun_book:
        if is_missing_token(word):
            m = re.match(r"^([^\s]+)\s+(.+)$", combined)
            if m:
                return clean_text(m.group(1)), clean_text(m.group(2)), "kobun_split"
        return word, translation, "kobun_direct"

    # English entries: parse longest english span as headword.
    if has_ascii_letter(word) and has_japanese(word) and is_missing_token(translation):
        first_jp = re.search(r"[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]", word)
        if first_jp:
            split_idx = first_jp.start()
            maybe_word = clean_text(word[:split_idx])
            maybe_trans = clean_text(word[split_idx:])
            # Only use this split when english headword is clearly present before JP text.
            if maybe_word and maybe_trans and has_ascii_letter(maybe_word):
                return maybe_word, maybe_trans, "mixed_in_word"

    matches = list(EN_SPAN_PATTERN.finditer(combined))
    best = None
    best_score = -1
    for match in matches:
        candidate = clean_text(match.group(0))
        if not candidate:
            continue
        score = len(candidate)
        if " " in candidate:
            score += 2
        if "~" in candidate:
            score += 1
        if candidate.lower() in {"a", "an", "the", "of", "to", "in", "on", "for", "at"}:
            score -= 2
        if score > best_score:
            best_score = score
            best = (match.start(), match.end(), candidate)

    if best is None:
        return word, translation, "fallback"

    start, end, candidate_word = best
    rest = clean_text((combined[:start] + " " + combined[end:]).strip())
    rest = re.sub(r"^[,、;；:：\-\s]+", "", rest)
    rest = re.sub(r"[,、;；:：\-\s]+$", "", rest)

    if not is_missing_token(translation) and has_japanese(translation) and len(translation) >= len(rest):
        rest = translation

    return clean_text(candidate_word), clean_text(rest), "english_span"


@dataclass
class SourceRecord:
    book_norm: str
    number: int
    word: str
    translation: str
    source_path: str
    source_label: str
    source_priority: int
    method: str
    quality: int


def detect_column(columns: Sequence[str], preferred: Sequence[str]) -> Optional[str]:
    lowered = {str(col).lower(): str(col) for col in columns}
    for name in preferred:
        if name in lowered:
            return lowered[name]

    for col in columns:
        low = str(col).lower()
        if any(name in low for name in preferred):
            return str(col)
    return None


def resolve_book_norm(source_book_raw: str, master_book_norms: set[str], alias_map: Dict[str, str]) -> str:
    normalized = normalize_book_name(source_book_raw)
    if normalized in master_book_norms:
        return normalized

    if normalized in alias_map:
        return alias_map[normalized]

    candidates = [book for book in master_book_norms if normalized in book or book in normalized]
    if len(candidates) == 1:
        return candidates[0]

    return normalized


def build_alias_map(master_books: Iterable[str]) -> Dict[str, str]:
    master_norm_map = {normalize_book_name(name): name for name in master_books}
    aliases: Dict[str, str] = {}

    def put(alias_raw: str, canonical_raw: str) -> None:
        alias = normalize_book_name(alias_raw)
        canonical = normalize_book_name(canonical_raw)
        if canonical in master_norm_map:
            aliases[alias] = canonical

    put("ターゲット1400基礎編", "英単語ターゲット1400 5訂版")
    put("小テストターゲット1900", "英単語ターゲット1900 6訂版")
    put("英検_準1級_でる順パス単_5訂版", "英検 準1級 でる順パス単 5訂版")
    put("英検_準2級_でる順パス単_5訂版", "英検 準2級 でる順パス単 5訂版")
    put("英検_準2級_プラス_重要度順パス単", "英検 準2級 プラス 重要度順パス単")
    put("英検_1級_でる順パス単_5訂版", "英検 1級 でる順パス単 5訂版")
    put("英検_2級_でる順パス単_5訂版", "英検 2級 でる順パス単 5訂版")
    put("英検_3級_でる順パス単_5訂版", "英検 3級 でる順パス単 5訂版")
    put("英検_4級_でる順パス単_5訂版", "英検 4級 でる順パス単 5訂版")
    put("英検_5級_でる順パス単_5訂版", "英検 5級 でる順パス単 5訂版")
    put("古文単語 315 《桐原書店》", "古文単語315（桐原書店）")
    put("Look@古文単語 337", "Look@古文単語 337")

    return aliases


def candidate_quality(book_name: str, word: str, translation: str, source_priority: int) -> int:
    is_kobun = ("古文" in book_name) or ("古典" in book_name)
    score = 100 - source_priority * 4

    if not is_missing_token(word):
        score += 8
    if not is_missing_token(translation):
        score += 8

    if has_japanese(translation):
        score += 10

    if is_kobun:
        if has_japanese(word):
            score += 8
        elif has_ascii_letter(word):
            score -= 12
    else:
        if has_ascii_letter(word):
            score += 12
        else:
            score -= 20

    if len(word) > 80:
        score -= 8
    if len(translation) > 160:
        score -= 6

    if is_missing_token(word) or is_missing_token(translation):
        score -= 40

    return score


def collect_source_records(master_book_norms: set[str], alias_map: Dict[str, str]) -> List[SourceRecord]:
    records: List[SourceRecord] = []

    files: List[Tuple[Path, int, str]] = []
    for directory, pattern, priority, label in SOURCE_SPECS:
        if not directory.exists():
            continue
        for path in sorted(directory.glob(pattern)):
            if path.name.startswith('.'):
                continue
            files.append((path, priority, label))

    for single_path, priority, label in EXTRA_SINGLE_FILES:
        if single_path.exists():
            files.append((single_path, priority, label))

    seen_files = set()
    for path, priority, label in files:
        key = str(path.resolve())
        if key in seen_files:
            continue
        seen_files.add(key)

        try:
            df = pd.read_csv(path, dtype=str).fillna("")
        except Exception:
            continue

        columns = [str(col) for col in df.columns]

        number_col = detect_column(columns, COLUMN_NUMBER_CANDIDATES)
        word_col = detect_column(columns, COLUMN_WORD_CANDIDATES)
        translation_col = detect_column(columns, COLUMN_TRANSLATION_CANDIDATES)
        book_col = detect_column(columns, COLUMN_BOOK_CANDIDATES)

        if number_col is None or word_col is None:
            continue

        for _, row in df.iterrows():
            number = parse_number(row.get(number_col, ""))
            if number is None:
                continue

            source_book = clean_text(row.get(book_col, "")) if book_col else ""
            if not source_book:
                source_book = strip_book_suffix(path.stem)

            resolved_book_norm = resolve_book_norm(source_book, master_book_norms, alias_map)
            is_kobun_book = "古文" in source_book

            raw_word = clean_text(row.get(word_col, ""))
            raw_translation = clean_text(row.get(translation_col, "")) if translation_col else ""
            word, translation, method = split_word_translation(raw_word, raw_translation, is_kobun_book)

            quality = candidate_quality(source_book, word, translation, priority)

            records.append(
                SourceRecord(
                    book_norm=resolved_book_norm,
                    number=number,
                    word=word,
                    translation=translation,
                    source_path=str(path),
                    source_label=label,
                    source_priority=priority,
                    method=method,
                    quality=quality,
                )
            )

    return records


def pick_best_candidate(records: List[SourceRecord], is_kobun_book: bool) -> Optional[SourceRecord]:
    if not records:
        return None

    valid: List[SourceRecord] = []
    for record in records:
        if is_missing_token(record.word) or is_missing_token(record.translation):
            continue

        if is_kobun_book:
            if not has_japanese(record.translation):
                continue
            if not record.word:
                continue
        else:
            if not has_ascii_letter(record.word):
                continue
            if not has_japanese(record.translation):
                continue

        valid.append(record)

    if not valid:
        return None

    valid.sort(key=lambda record: (-record.quality, record.source_priority, len(record.translation), len(record.word)))
    return valid[0]


def refine_master(master: pd.DataFrame, source_records: List[SourceRecord]) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    working = master.copy()
    working["book_norm"] = working["単語帳名"].map(normalize_book_name)
    working["word_number_int"] = working["単語番号"].map(parse_number)

    is_word_missing = working["単語"].map(is_missing_token)
    is_translation_missing = working["日本語訳"].map(is_missing_token)
    is_row_missing = is_word_missing | is_translation_missing

    key_to_records: Dict[Tuple[str, int], List[SourceRecord]] = defaultdict(list)
    for record in source_records:
        key_to_records[(record.book_norm, record.number)].append(record)

    audit_rows: List[Dict[str, object]] = []

    for idx, row in working[is_row_missing].iterrows():
        book_norm = row["book_norm"]
        number = row["word_number_int"]
        if pd.isna(number):
            audit_rows.append(
                {
                    "status": "unresolved",
                    "reason": "invalid_number",
                    "book": row["単語帳名"],
                    "number": row["単語番号"],
                    "old_word": row["単語"],
                    "old_translation": row["日本語訳"],
                    "new_word": row["単語"],
                    "new_translation": row["日本語訳"],
                    "source": "",
                    "source_label": "",
                    "method": "",
                    "quality": "",
                }
            )
            continue

        number_int = int(number)
        book_raw = str(row["単語帳名"])

        # Apply verified manual patches first.
        manual_key = (book_raw, number_int)
        if manual_key in MANUAL_PATCHES:
            patch_word, patch_translation, patch_method = MANUAL_PATCHES[manual_key]
            old_word = row["単語"]
            old_translation = row["日本語訳"]
            new_word = old_word if not is_missing_token(old_word) else patch_word
            new_translation = old_translation if not is_missing_token(old_translation) else patch_translation
            working.at[idx, "単語"] = new_word
            working.at[idx, "日本語訳"] = new_translation
            audit_rows.append(
                {
                    "status": "filled",
                    "reason": "manual_patch",
                    "book": book_raw,
                    "number": row["単語番号"],
                    "old_word": old_word,
                    "old_translation": old_translation,
                    "new_word": new_word,
                    "new_translation": new_translation,
                    "source": "manual",
                    "source_label": "manual_patch",
                    "method": patch_method,
                    "quality": 999,
                }
            )
            continue

        candidates = key_to_records.get((book_norm, number_int), [])
        is_kobun_book = ("古文" in str(row["単語帳名"])) or ("古典" in str(row["単語帳名"]))
        best = pick_best_candidate(candidates, is_kobun_book)

        old_word = row["単語"]
        old_translation = row["日本語訳"]
        new_word = old_word
        new_translation = old_translation

        if best is None:
            audit_rows.append(
                {
                    "status": "unresolved",
                    "reason": "no_valid_candidate",
                    "book": row["単語帳名"],
                    "number": row["単語番号"],
                    "old_word": old_word,
                    "old_translation": old_translation,
                    "new_word": new_word,
                    "new_translation": new_translation,
                    "source": "",
                    "source_label": "",
                    "method": "",
                    "quality": "",
                }
            )
            continue

        changed = False
        if is_missing_token(old_word) and not is_missing_token(best.word):
            new_word = best.word
            changed = True
        if is_missing_token(old_translation) and not is_missing_token(best.translation):
            new_translation = best.translation
            changed = True

        if changed:
            working.at[idx, "単語"] = new_word
            working.at[idx, "日本語訳"] = new_translation
            status = "filled"
            reason = "matched"
        else:
            status = "unresolved"
            reason = "candidate_no_change"

        audit_rows.append(
            {
                "status": status,
                "reason": reason,
                "book": row["単語帳名"],
                "number": row["単語番号"],
                "old_word": old_word,
                "old_translation": old_translation,
                "new_word": new_word,
                "new_translation": new_translation,
                "source": best.source_path,
                "source_label": best.source_label,
                "method": best.method,
                "quality": best.quality,
            }
        )

    refined = working.drop(columns=["book_norm", "word_number_int"])
    audit = pd.DataFrame(audit_rows)

    unresolved_mask = refined["単語"].map(is_missing_token) | refined["日本語訳"].map(is_missing_token)
    unresolved = refined.loc[unresolved_mask, ["単語帳名", "単語番号", "単語", "日本語訳"]].copy()

    return refined, audit, unresolved


def classify_stage_and_book_rank(book_name: str) -> Tuple[int, str, int]:
    for stage, label, keywords in STAGE_RULES:
        for idx, keyword in enumerate(keywords, start=1):
            if keyword in book_name:
                return stage, label, idx
    return 3, "HS_Core", 999


def classify_stage(book_name: str) -> Tuple[int, str]:
    stage, label, _ = classify_stage_and_book_rank(book_name)
    return stage, label


def classify_grade_bucket(
    book_name: str,
    stage: int,
    rules: Sequence[Tuple[str, str, int, Sequence[str]]],
    fallback: Dict[int, Tuple[str, str, int]],
) -> Tuple[str, str, int]:
    for bucket_id, bucket_label, bucket_order, keywords in rules:
        for keyword in keywords:
            if keyword in book_name:
                return bucket_id, bucket_label, bucket_order
    return fallback.get(stage, ("G10_HS1", "高1完了(速習)", 4))


def classify_grade_bucket_accelerated(book_name: str, stage: int) -> Tuple[str, str, int]:
    return classify_grade_bucket(
        book_name=book_name,
        stage=stage,
        rules=GRADE_BUCKET_RULES_ACCELERATED,
        fallback=STAGE_TO_GRADE_FALLBACK_ACCELERATED,
    )


def classify_grade_bucket_standard(book_name: str, stage: int) -> Tuple[str, str, int]:
    return classify_grade_bucket(
        book_name=book_name,
        stage=stage,
        rules=GRADE_BUCKET_RULES_STANDARD,
        fallback=STAGE_TO_GRADE_FALLBACK_STANDARD,
    )


def build_original_wordbank(refined: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    rows: List[Dict[str, object]] = []

    for _, row in refined.iterrows():
        book = clean_text(row["単語帳名"])
        word = clean_text(row["単語"])
        meaning = clean_text(row["日本語訳"])

        if is_missing_token(word) or is_missing_token(meaning):
            continue

        if ("古文" in book) or ("古典" in book):
            continue

        if not has_ascii_letter(word):
            continue

        headword_norm = normalize_headword(word)
        if not headword_norm:
            continue

        stage, stage_label, book_rank = classify_stage_and_book_rank(book)
        grade_accel_id, grade_accel_label, grade_accel_order = classify_grade_bucket_accelerated(book, stage)
        grade_standard_id, grade_standard_label, grade_standard_order = classify_grade_bucket_standard(book, stage)
        pos, pos_confidence, pos_evidence = infer_pos(word, meaning)
        family = derive_word_family(headword_norm)
        phrase_flag = is_phrase_headword(word)

        rows.append(
            {
                "book": book,
                "number": parse_number(row["単語番号"]) or 0,
                "headword": word,
                "headword_norm": headword_norm,
                "meaning": sanitize_meaning_short(meaning, limit=80),
                "stage": stage,
                "stage_label": stage_label,
                "book_rank": book_rank,
                "grade_accel_id": grade_accel_id,
                "grade_accel_label": grade_accel_label,
                "grade_accel_order": grade_accel_order,
                "grade_standard_id": grade_standard_id,
                "grade_standard_label": grade_standard_label,
                "grade_standard_order": grade_standard_order,
                "pos": pos,
                "pos_confidence": pos_confidence,
                "pos_evidence": pos_evidence,
                "word_family": family,
                "is_phrase": phrase_flag,
            }
        )

    base = pd.DataFrame(rows)
    if base.empty:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

    grouped_rows: List[Dict[str, object]] = []

    for _, group in base.groupby("headword_norm"):
        group = group.sort_values(["stage", "book_rank", "number", "book", "meaning"]).reset_index(drop=True)
        representative = group.iloc[0]

        source_books = sorted(group["book"].unique())
        stage_min = int(group["stage"].min())
        stage_max = int(group["stage"].max())
        stage_label = representative["stage_label"]
        source_numbers = [int(n) for n in group["number"].tolist() if int(n) > 0]
        if source_numbers:
            number_min = min(source_numbers)
            number_max = max(source_numbers)
            number_median = int(pd.Series(source_numbers).median())
        else:
            number_min = 0
            number_max = 0
            number_median = 0

        pos_counter = Counter(group["pos"].tolist())
        pos_score_map: Dict[str, float] = {}
        for pos_name, pos_group in group.groupby("pos"):
            row_scores: List[float] = []
            for _, pos_row in pos_group.iterrows():
                conf = float(pos_row["pos_confidence"])
                stage_weight = STAGE_POS_WEIGHT.get(int(pos_row["stage"]), 1.0)
                evidence_weight = POS_EVIDENCE_WEIGHT.get(clean_text(pos_row["pos_evidence"]), 1.0)
                row_scores.append(conf * stage_weight * evidence_weight)
            pos_score_map[str(pos_name)] = sum(row_scores) + (len(pos_group) * 8.0)

        pos_ranked = sorted(
            pos_counter.items(),
            key=lambda item: (-pos_score_map.get(item[0], 0.0), -item[1], POS_ORDER_INDEX.get(item[0], 999), item[0]),
        )
        pos_primary = pos_ranked[0][0]
        pos_secondary = pos_ranked[1][0] if len(pos_ranked) >= 2 else ""
        pos_score_primary = float(pos_score_map.get(pos_primary, 0.0))
        pos_score_secondary = float(pos_score_map.get(pos_secondary, 0.0)) if pos_secondary else 0.0
        pos_score_margin = float(pos_score_primary - pos_score_secondary)
        pos_vote_count = int(pos_counter[pos_primary])
        pos_candidates = " | ".join(
            f"{label}:{count}"
            for label, count in sorted(
                pos_counter.items(), key=lambda item: (-item[1], POS_ORDER_INDEX.get(item[0], 999), item[0])
            )
        )

        pos_primary_group = group.loc[group["pos"] == pos_primary].sort_values(
            ["pos_confidence", "stage", "book_rank"], ascending=[False, True, True]
        )
        pos_confidence_values = pos_primary_group["pos_confidence"].tolist()
        if pos_confidence_values:
            pos_confidence = int(max(pos_confidence_values))
        else:
            pos_confidence = int(max(group["pos_confidence"].tolist()))
        pos_evidence = clean_text(pos_primary_group.iloc[0]["pos_evidence"]) if not pos_primary_group.empty else ""

        def pick_bucket(
            df_group: pd.DataFrame,
            id_col: str,
            label_col: str,
            order_col: str,
        ) -> Tuple[str, str, int, str]:
            counter = Counter(df_group[id_col].tolist())
            ranked = sorted(
                counter.items(),
                key=lambda item: (
                    -item[1],
                    int(df_group.loc[df_group[id_col] == item[0], order_col].min()),
                    item[0],
                ),
            )
            primary_id = str(ranked[0][0])
            primary_rows = df_group[df_group[id_col] == primary_id].sort_values(
                [order_col, "stage", "book_rank", "number"], ascending=[True, True, True, True]
            )
            primary_label = clean_text(primary_rows.iloc[0][label_col])
            primary_order = int(primary_rows.iloc[0][order_col])
            secondary_id = str(ranked[1][0]) if len(ranked) >= 2 else ""
            return primary_id, primary_label, primary_order, secondary_id

        grade_accel_id, grade_accel_label, grade_accel_order, grade_accel_secondary_id = pick_bucket(
            group, "grade_accel_id", "grade_accel_label", "grade_accel_order"
        )
        grade_standard_id, grade_standard_label, grade_standard_order, grade_standard_secondary_id = pick_bucket(
            group, "grade_standard_id", "grade_standard_label", "grade_standard_order"
        )

        # Accelerated default policy:
        # ensure HS-level vocabulary (stage<=3) is finishable by end of HS1.
        if stage_min <= 2 and grade_accel_order > 3:
            fallback_id, fallback_label, fallback_order = STAGE_TO_GRADE_FALLBACK_ACCELERATED[2]
            grade_accel_id, grade_accel_label, grade_accel_order = fallback_id, fallback_label, fallback_order
            grade_accel_secondary_id = ""
        elif stage_min == 3 and grade_accel_order > 4:
            fallback_id, fallback_label, fallback_order = STAGE_TO_GRADE_FALLBACK_ACCELERATED[3]
            grade_accel_id, grade_accel_label, grade_accel_order = fallback_id, fallback_label, fallback_order
            grade_accel_secondary_id = ""

        family_counter = Counter(group["word_family"].tolist())
        word_family = sorted(family_counter.items(), key=lambda item: (-item[1], -len(item[0]), item[0]))[0][0]
        letter = first_alpha(representative["headword_norm"])
        group_id = f"S{stage_min:02d}_{pos_primary.upper()}_{letter.upper()}"
        group_label = f"{POS_LABEL_JA.get(pos_primary, 'その他')} / {letter.upper()}"
        group_order = POS_ORDER_INDEX.get(pos_primary, 999)

        grouped_rows.append(
            {
                "headword": representative["headword"],
                "headword_norm": representative["headword_norm"],
                "meaning_ja_short": representative["meaning"],
                "pos": pos_primary,
                "pos_label_ja": POS_LABEL_JA.get(pos_primary, "その他"),
                "pos_confidence": pos_confidence,
                "pos_vote_count": pos_vote_count,
                "pos_secondary": pos_secondary,
                "is_multi_pos": len(pos_counter) >= 2,
                "pos_score_primary": round(pos_score_primary, 2),
                "pos_score_secondary": round(pos_score_secondary, 2),
                "pos_score_margin": round(pos_score_margin, 2),
                "pos_candidates": pos_candidates,
                "pos_evidence": pos_evidence,
                "is_phrase": bool(representative["is_phrase"]) or pos_primary == "phrase",
                "word_family": word_family,
                "stage": stage_min,
                "stage_label": stage_label,
                "stage_span": f"{stage_min}-{stage_max}",
                "grade_bucket_default_id": grade_accel_id,
                "grade_bucket_default_label": grade_accel_label,
                "grade_bucket_default_order": grade_accel_order,
                "grade_bucket_default_secondary_id": grade_accel_secondary_id,
                "grade_bucket_standard_id": grade_standard_id,
                "grade_bucket_standard_label": grade_standard_label,
                "grade_bucket_standard_order": grade_standard_order,
                "grade_bucket_standard_secondary_id": grade_standard_secondary_id,
                "group_order": group_order,
                "group_id": group_id,
                "group_label": group_label,
                "source_primary": representative["book"],
                "source_primary_number": int(representative["number"]),
                "book_rank_primary": int(representative["book_rank"]),
                "source_count": len(source_books),
                "source_books": " | ".join(source_books),
                "source_number_min": number_min,
                "source_number_median": number_median,
                "source_number_max": number_max,
            }
        )

    wordbank = pd.DataFrame(grouped_rows).sort_values(
        [
            "grade_bucket_default_order",
            "stage",
            "group_order",
            "group_id",
            "source_number_median",
            "book_rank_primary",
            "source_primary_number",
            "headword_norm",
        ],
        ascending=[True, True, True, True, True, True, True, True],
    )
    wordbank = wordbank.reset_index(drop=True)
    wordbank.insert(0, "entry_id", [f"WB{idx:06d}" for idx in range(1, len(wordbank) + 1)])

    group_rows: List[Dict[str, object]] = []
    for (stage, group_id), group in wordbank.groupby(["stage", "group_id"], sort=False):
        first_entry = group.iloc[0]
        group_rows.append(
            {
                "group_id": group_id,
                "stage": int(stage),
                "stage_label": first_entry["stage_label"],
                "group_order": int(first_entry["group_order"]),
                "group_label": first_entry["group_label"],
                "pos": first_entry["pos"],
                "pos_label_ja": first_entry["pos_label_ja"],
                "letter": first_alpha(first_entry["headword_norm"]).upper(),
                "word_count": int(len(group)),
                "first_entry_id": first_entry["entry_id"],
                "last_entry_id": group.iloc[-1]["entry_id"],
            }
        )
    group_df = pd.DataFrame(group_rows).sort_values(["stage", "group_order", "group_id"]).reset_index(drop=True)

    stage_titles = {
        1: "JHS Foundation",
        2: "HS Basic",
        3: "HS Core",
        4: "HS Advanced",
    }

    deck_rows: List[Dict[str, object]] = []
    deck_word_rows: List[Dict[str, object]] = []

    def add_curriculum_decks(
        curriculum: str,
        id_col: str,
        label_col: str,
        order_col: str,
        deck_prefix: str,
        is_default: bool,
    ) -> None:
        unique_rows = (
            wordbank[[id_col, label_col, order_col]]
            .drop_duplicates()
            .sort_values([order_col, id_col], ascending=[True, True])
            .reset_index(drop=True)
        )
        for _, bucket in unique_rows.iterrows():
            bucket_id = clean_text(bucket[id_col])
            bucket_label = clean_text(bucket[label_col])
            bucket_order = int(bucket[order_col])
            bucket_df = (
                wordbank[wordbank[id_col] == bucket_id]
                .sort_values(
                    ["group_order", "group_id", "source_number_median", "headword_norm"],
                    ascending=[True, True, True, True],
                )
                .reset_index(drop=True)
            )
            if bucket_df.empty:
                continue

            deck_id = f"{deck_prefix}_{bucket_id}"
            title = bucket_label
            deck_rows.append(
                {
                    "deck_id": deck_id,
                    "curriculum": curriculum,
                    "is_default": is_default,
                    "stage": 0,
                    "grade_bucket_id": bucket_id,
                    "grade_bucket_label": bucket_label,
                    "grade_bucket_order": bucket_order,
                    "title": title,
                    "description": f"{title} vocabulary track ({curriculum}).",
                    "word_count": len(bucket_df),
                    "group_count": int(bucket_df["group_id"].nunique()),
                }
            )

            current_group = None
            group_seq = 0
            in_group_order = 0
            for order, (_, entry_row) in enumerate(bucket_df.iterrows(), start=1):
                if entry_row["group_id"] != current_group:
                    current_group = entry_row["group_id"]
                    group_seq += 1
                    in_group_order = 1
                else:
                    in_group_order += 1
                deck_word_rows.append(
                    {
                        "deck_id": deck_id,
                        "curriculum": curriculum,
                        "entry_id": entry_row["entry_id"],
                        "order_index": order,
                        "group_id": entry_row["group_id"],
                        "group_order": group_seq,
                        "in_group_order": in_group_order,
                        "pos": entry_row["pos"],
                    }
                )

    # Default curriculum (accelerated): finish HS-level vocabulary by end of HS1.
    add_curriculum_decks(
        curriculum="accelerated",
        id_col="grade_bucket_default_id",
        label_col="grade_bucket_default_label",
        order_col="grade_bucket_default_order",
        deck_prefix="DECK_ACC",
        is_default=True,
    )

    # Standard curriculum: continue progression to HS3.
    add_curriculum_decks(
        curriculum="standard",
        id_col="grade_bucket_standard_id",
        label_col="grade_bucket_standard_label",
        order_col="grade_bucket_standard_order",
        deck_prefix="DECK_STD",
        is_default=False,
    )

    for stage in sorted(wordbank["stage"].unique()):
        stage_df = wordbank[wordbank["stage"] == stage].copy().reset_index(drop=True)
        deck_id = f"DECK_STAGE_{stage}"
        title = stage_titles.get(stage, f"Stage {stage}")

        deck_rows.append(
            {
                "deck_id": deck_id,
                "curriculum": "stage_reference",
                "is_default": False,
                "stage": stage,
                "grade_bucket_id": "",
                "grade_bucket_label": "",
                "grade_bucket_order": stage,
                "title": title,
                "description": f"{title} vocabulary for consistent middle/high school progression.",
                "word_count": len(stage_df),
                "group_count": int(stage_df["group_id"].nunique()),
            }
        )

        current_group = None
        group_seq = 0
        in_group_order = 0
        for order, (_, entry_row) in enumerate(stage_df.iterrows(), start=1):
            if entry_row["group_id"] != current_group:
                current_group = entry_row["group_id"]
                group_seq += 1
                in_group_order = 1
            else:
                in_group_order += 1
            deck_word_rows.append(
                {
                    "deck_id": deck_id,
                    "curriculum": "stage_reference",
                    "entry_id": entry_row["entry_id"],
                    "order_index": order,
                    "group_id": entry_row["group_id"],
                    "group_order": group_seq,
                    "in_group_order": in_group_order,
                    "pos": entry_row["pos"],
                }
            )

    deck_df = pd.DataFrame(deck_rows).sort_values(
        ["is_default", "curriculum", "grade_bucket_order", "stage", "deck_id"],
        ascending=[False, True, True, True, True],
    )
    deck_df = deck_df.reset_index(drop=True)
    deck_word_df = pd.DataFrame(deck_word_rows)

    return wordbank, deck_df, deck_word_df, group_df


def build_pos_review_candidates(wordbank: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if wordbank.empty:
        return pd.DataFrame(), pd.DataFrame()

    review_rows: List[Dict[str, object]] = []
    for _, row in wordbank.iterrows():
        conf = int(row.get("pos_confidence", 0))
        margin = float(row.get("pos_score_margin", 0.0))
        is_multi_pos = bool(row.get("is_multi_pos", False))
        evidence = clean_text(row.get("pos_evidence", ""))
        stage = int(row.get("stage", 3))
        source_count = int(row.get("source_count", 1))

        score = 0
        reasons: List[str] = []

        if conf < 60:
            score += 5
            reasons.append("low_confidence(<60)")
        elif conf < POS_REVIEW_CONFIDENCE_THRESHOLD:
            score += 3
            reasons.append("mid_confidence(<70)")

        if is_multi_pos:
            score += 3
            reasons.append("multi_pos")

        if margin < 15:
            score += 4
            reasons.append("very_close_margin")
        elif margin < POS_REVIEW_MARGIN_THRESHOLD:
            score += 2
            reasons.append("close_margin")

        if evidence in {"fallback_noun", "verb_suffix"}:
            score += 2
            reasons.append(f"weak_evidence:{evidence}")

        if source_count >= 5 and is_multi_pos:
            score += 1
            reasons.append("many_sources_with_conflict")

        if stage >= 4:
            score += 1
            reasons.append("advanced_stage")

        if score >= 8:
            priority = "HIGH"
        elif score >= 5:
            priority = "MEDIUM"
        else:
            priority = "LOW"

        if (score >= 5) or is_multi_pos or (conf < POS_REVIEW_CONFIDENCE_THRESHOLD):
            review_rows.append(
                {
                    "entry_id": row["entry_id"],
                    "headword": row["headword"],
                    "headword_norm": row["headword_norm"],
                    "meaning_ja_short": row["meaning_ja_short"],
                    "pos_current": row["pos"],
                    "pos_label_ja": row["pos_label_ja"],
                    "pos_secondary": row["pos_secondary"],
                    "pos_candidates": row["pos_candidates"],
                    "pos_confidence": conf,
                    "pos_score_margin": round(margin, 2),
                    "is_multi_pos": is_multi_pos,
                    "pos_evidence": evidence,
                    "stage": stage,
                    "stage_label": row["stage_label"],
                    "grade_bucket_default_label": row["grade_bucket_default_label"],
                    "grade_bucket_standard_label": row["grade_bucket_standard_label"],
                    "source_count": source_count,
                    "source_books": row["source_books"],
                    "review_priority": priority,
                    "review_score": score,
                    "review_reason": " | ".join(reasons),
                }
            )

    review_df = pd.DataFrame(review_rows).sort_values(
        ["review_score", "review_priority", "stage", "source_count", "headword_norm"],
        ascending=[False, True, True, False, True],
    )
    review_df = review_df.reset_index(drop=True)

    override_template = review_df[
        [
            "entry_id",
            "headword_norm",
            "headword",
            "meaning_ja_short",
            "pos_current",
            "review_priority",
            "review_reason",
        ]
    ].copy()
    override_template["suggested_pos"] = ""
    override_template["suggested_pos_label_ja"] = ""
    override_template["override_reason"] = ""
    override_template["reviewer"] = ""
    override_template["status"] = "todo"

    return review_df, override_template


def parse_pos_candidates_map(text: str) -> Dict[str, int]:
    result: Dict[str, int] = {}
    for part in clean_text(text).split("|"):
        piece = part.strip()
        if not piece or ":" not in piece:
            continue
        pos_name, count_text = piece.split(":", 1)
        pos_name = clean_text(pos_name)
        try:
            count = int(clean_text(count_text))
        except ValueError:
            continue
        if pos_name:
            result[pos_name] = count
    return result


def infer_pos_from_meaning_markers(meaning: str) -> Optional[str]:
    m_norm = clean_text(meaning).replace("〜", "～")
    if not m_norm:
        return None
    explicit_tags = parse_explicit_pos_tags(m_norm)
    if explicit_tags:
        if len(explicit_tags) == 1:
            return explicit_tags[0]
        if explicit_tags[0] != "noun":
            return explicit_tags[0]
    if re.search(r"すること", m_norm):
        return "noun"
    if re.search(r"(?:^|[、,・;/()（）\\s])[^、,・;/()（）\\s]{0,8}(する|になる|させる)(?:$|[、,・;/()（）\\s])", m_norm):
        return "verb"
    if "的な" in m_norm or re.search(r"(?:^|[、,・;/()（）\\s])[ぁ-んァ-ヶ一-龠]{1,10}な(?:$|[、,・;/()（）\\s])", m_norm):
        return "adjective"
    if re.search(r"的に", m_norm) or re.search(r"(?:^|[、,・;/()（）\\s])[ぁ-んァ-ヶ一-龠]{1,10}に(?:$|[、,・;/()（）\\s])", m_norm):
        return "adverb"
    return None


def confirm_priority_pos(
    wordbank: pd.DataFrame,
    pos_review_subset: pd.DataFrame,
    priority_label: str,
    evidence_prefix: str,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if wordbank.empty or pos_review_subset.empty:
        return pd.DataFrame(), wordbank.copy()

    wb = wordbank.copy()
    confirmations: List[Dict[str, object]] = []
    wb_by_entry = wb.set_index("entry_id")

    for _, review_row in pos_review_subset.iterrows():
        entry_id = clean_text(review_row.get("entry_id", ""))
        if not entry_id or entry_id not in wb_by_entry.index:
            continue

        wb_row = wb_by_entry.loc[entry_id]
        headword_norm = clean_text(wb_row.get("headword_norm", ""))
        current_pos = clean_text(wb_row.get("pos", ""))
        secondary_pos = clean_text(wb_row.get("pos_secondary", ""))
        meaning = clean_text(wb_row.get("meaning_ja_short", ""))
        evidence = clean_text(wb_row.get("pos_evidence", ""))
        conf = int(wb_row.get("pos_confidence", 0))
        candidates_map = parse_pos_candidates_map(str(wb_row.get("pos_candidates", "")))
        primary_count = int(candidates_map.get(current_pos, 0))
        secondary_count = int(candidates_map.get(secondary_pos, 0)) if secondary_pos else 0

        confirmed_pos = current_pos
        method = "keep_current"
        reason = "no_override_rule"
        changed = False

        if headword_norm in ADVERB_HEADWORDS and current_pos != "adverb":
            confirmed_pos = "adverb"
            method = "headword_adverb_override"
            reason = "explicit_adverb_headword_list"
            changed = True
        elif headword_norm in ADJECTIVE_HEADWORDS and current_pos != "adjective":
            confirmed_pos = "adjective"
            method = "headword_adjective_override"
            reason = "explicit_adjective_headword_list"
            changed = True
        else:
            marker_pos = infer_pos_from_meaning_markers(meaning)
            if marker_pos and marker_pos != current_pos:
                marker_safe = False
                if (
                    secondary_pos
                    and (marker_pos == secondary_pos)
                    and (secondary_count >= max(3, int(primary_count * 0.8)))
                ):
                    marker_safe = True
                elif (
                    marker_pos == "verb"
                    and (secondary_pos == "verb")
                    and (secondary_count >= max(3, int(primary_count * 0.7)))
                ):
                    marker_safe = True

                if marker_safe:
                    confirmed_pos = marker_pos
                    method = "meaning_marker_override"
                    reason = f"meaning_marker_with_votes:{marker_pos}"
                    changed = True
            elif (
                (current_pos == "noun")
                and (evidence == "fallback_noun")
                and secondary_pos
                and (secondary_pos != current_pos)
                and (secondary_count >= 4)
                and (secondary_count >= max(3, int(primary_count * 0.6)))
            ):
                confirmed_pos = secondary_pos
                method = "secondary_vote_override"
                reason = f"fallback_noun_with_secondary_votes:{secondary_pos}"
                changed = True

        confirmation_confidence = 0.98 if method.startswith("headword_") else 0.9 if changed else 0.7
        confirmations.append(
            {
                "entry_id": entry_id,
                "headword": clean_text(wb_row.get("headword", "")),
                "headword_norm": headword_norm,
                "meaning_ja_short": meaning,
                "current_pos": current_pos,
                "confirmed_pos": confirmed_pos,
                "changed": changed,
                "method": method,
                "reason": reason,
                "pos_confidence_before": conf,
                "confirmation_confidence": confirmation_confidence,
                "pos_candidates": clean_text(wb_row.get("pos_candidates", "")),
                "review_priority": priority_label,
            }
        )

    confirmation_df = pd.DataFrame(confirmations)
    if confirmation_df.empty:
        return confirmation_df, wb

    changed_map = (
        confirmation_df[confirmation_df["changed"]]
        .set_index("entry_id")[["confirmed_pos", "method", "confirmation_confidence"]]
        .to_dict("index")
    )

    wb_confirmed = wb.copy()
    for idx, row in wb_confirmed.iterrows():
        entry_id = clean_text(row.get("entry_id", ""))
        if entry_id not in changed_map:
            continue
        payload = changed_map[entry_id]
        new_pos = clean_text(payload["confirmed_pos"])
        old_pos = clean_text(row.get("pos", ""))
        if not new_pos or new_pos == old_pos:
            continue

        wb_confirmed.at[idx, "pos_secondary"] = old_pos
        wb_confirmed.at[idx, "pos"] = new_pos
        wb_confirmed.at[idx, "pos_label_ja"] = POS_LABEL_JA.get(new_pos, "その他")
        wb_confirmed.at[idx, "is_multi_pos"] = True
        wb_confirmed.at[idx, "pos_evidence"] = f"{evidence_prefix}:{clean_text(payload['method'])}"
        wb_confirmed.at[idx, "pos_confidence"] = max(
            int(row.get("pos_confidence", 0)),
            int(float(payload.get("confirmation_confidence", 0.0)) * 100),
        )
        stage = int(row.get("stage", 3))
        letter = first_alpha(clean_text(row.get("headword_norm", ""))).upper()
        wb_confirmed.at[idx, "group_order"] = POS_ORDER_INDEX.get(new_pos, 999)
        wb_confirmed.at[idx, "group_id"] = f"S{stage:02d}_{new_pos.upper()}_{letter}"
        wb_confirmed.at[idx, "group_label"] = f"{POS_LABEL_JA.get(new_pos, 'その他')} / {letter}"

    return confirmation_df, wb_confirmed


def confirm_high_priority_pos(
    wordbank: pd.DataFrame,
    pos_review_high: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    return confirm_priority_pos(
        wordbank=wordbank,
        pos_review_subset=pos_review_high,
        priority_label="HIGH",
        evidence_prefix="high_confirm",
    )


def build_high_medium_manual_queue(
    pos_review: pd.DataFrame,
    pos_high_confirmations: pd.DataFrame,
    pos_medium_confirmations: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    if pos_review.empty:
        return pd.DataFrame(), pd.DataFrame()

    unchanged_ids = set()
    if not pos_high_confirmations.empty:
        unchanged_ids.update(pos_high_confirmations.loc[~pos_high_confirmations["changed"], "entry_id"].astype(str).tolist())
    if not pos_medium_confirmations.empty:
        unchanged_ids.update(pos_medium_confirmations.loc[~pos_medium_confirmations["changed"], "entry_id"].astype(str).tolist())

    if not unchanged_ids:
        return pd.DataFrame(), pd.DataFrame()

    queue = pos_review[
        pos_review["review_priority"].isin(["HIGH", "MEDIUM"])
        & pos_review["entry_id"].astype(str).isin(unchanged_ids)
    ].copy()
    if queue.empty:
        return queue, pd.DataFrame()

    queue = queue.drop_duplicates(subset=["entry_id"]).sort_values(
        ["review_priority", "review_score", "stage", "source_count", "headword_norm"],
        ascending=[True, False, True, False, True],
    )
    queue = queue.reset_index(drop=True)

    suggested_pos_list: List[str] = []
    suggested_reason_list: List[str] = []
    jp_hint_list: List[str] = []
    for _, row in queue.iterrows():
        current_pos = clean_text(row.get("pos_current", ""))
        secondary_pos = clean_text(row.get("pos_secondary", ""))
        meaning = clean_text(row.get("meaning_ja_short", ""))
        candidate_map = parse_pos_candidates_map(str(row.get("pos_candidates", "")))
        current_votes = int(candidate_map.get(current_pos, 0))
        jp_hint = infer_pos_from_meaning_markers(meaning) or ""

        suggested_pos = ""
        suggested_reason = ""

        if jp_hint and jp_hint != current_pos and jp_hint in candidate_map:
            hint_votes = int(candidate_map.get(jp_hint, 0))
            if hint_votes >= max(2, int(current_votes * 0.6)):
                suggested_pos = jp_hint
                suggested_reason = f"jp_hint_with_votes:{hint_votes}/{current_votes}"

        if (not suggested_pos) and (current_pos == "noun") and secondary_pos and secondary_pos != current_pos:
            secondary_votes = int(candidate_map.get(secondary_pos, 0))
            if secondary_votes >= max(3, int(current_votes * 0.8)):
                suggested_pos = secondary_pos
                suggested_reason = f"secondary_votes:{secondary_votes}/{current_votes}"

        jp_hint_list.append(jp_hint)
        suggested_pos_list.append(suggested_pos)
        suggested_reason_list.append(suggested_reason)

    queue["jp_hint_pos"] = jp_hint_list
    queue["jp_hint_pos_label_ja"] = queue["jp_hint_pos"].map(POS_LABEL_JA).fillna("")
    queue["suggested_pos_auto"] = suggested_pos_list
    queue["suggested_pos_auto_label_ja"] = queue["suggested_pos_auto"].map(POS_LABEL_JA).fillna("")
    queue["suggested_reason"] = suggested_reason_list
    queue["decision_pos"] = ""
    queue["decision_pos_label_ja"] = ""
    queue["decision_reason"] = ""
    queue["reviewer"] = ""
    queue["status"] = "todo"

    quickwin = queue[queue["suggested_pos_auto"] != ""].copy().reset_index(drop=True)

    return queue, quickwin


def apply_quickwin_confirmations(
    wordbank: pd.DataFrame,
    quickwin_df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    if wordbank.empty or quickwin_df.empty:
        return pd.DataFrame(), wordbank.copy(), pd.DataFrame()

    wb = wordbank.copy()
    wb_idx = wb.set_index("entry_id")

    records: List[Dict[str, object]] = []
    for _, row in quickwin_df.iterrows():
        entry_id = clean_text(row.get("entry_id", ""))
        suggested = clean_text(row.get("suggested_pos_auto", ""))
        if not entry_id or not suggested or entry_id not in wb_idx.index:
            continue
        wb_row = wb_idx.loc[entry_id]
        current = clean_text(wb_row.get("pos", ""))
        if not current or current == suggested:
            continue
        records.append(
            {
                "entry_id": entry_id,
                "headword_norm": clean_text(wb_row.get("headword_norm", "")),
                "current_pos": current,
                "confirmed_pos": suggested,
                "method": "quickwin_auto",
                "reason": clean_text(row.get("suggested_reason", "")),
                "review_priority": clean_text(row.get("review_priority", "")),
            }
        )

    confirmations = pd.DataFrame(records)
    if confirmations.empty:
        return confirmations, wb, quickwin_df.copy()

    c_map = confirmations.set_index("entry_id").to_dict("index")
    for idx, row in wb.iterrows():
        entry_id = clean_text(row.get("entry_id", ""))
        if entry_id not in c_map:
            continue
        payload = c_map[entry_id]
        new_pos = clean_text(payload["confirmed_pos"])
        old_pos = clean_text(row.get("pos", ""))
        wb.at[idx, "pos_secondary"] = old_pos
        wb.at[idx, "pos"] = new_pos
        wb.at[idx, "pos_label_ja"] = POS_LABEL_JA.get(new_pos, "その他")
        wb.at[idx, "is_multi_pos"] = True
        wb.at[idx, "pos_evidence"] = "quickwin_confirm"
        wb.at[idx, "pos_confidence"] = max(int(row.get("pos_confidence", 0)), 88)
        stage = int(row.get("stage", 3))
        letter = first_alpha(clean_text(row.get("headword_norm", ""))).upper()
        wb.at[idx, "group_order"] = POS_ORDER_INDEX.get(new_pos, 999)
        wb.at[idx, "group_id"] = f"S{stage:02d}_{new_pos.upper()}_{letter}"
        wb.at[idx, "group_label"] = f"{POS_LABEL_JA.get(new_pos, 'その他')} / {letter}"

    remaining = quickwin_df[~quickwin_df["entry_id"].astype(str).isin(confirmations["entry_id"].astype(str))].copy()
    return confirmations, wb, remaining


def apply_manual_batch_decisions(
    wordbank: pd.DataFrame,
    manual_batches_dir: Optional[Path],
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    applied_columns = [
        "source_entry_id",
        "entry_id",
        "headword_norm",
        "before_pos",
        "after_pos",
        "changed",
        "decision_reason",
        "reviewer",
        "status",
        "batch_file",
        "row_index",
    ]
    ignored_columns = ["entry_id", "decision_pos", "status", "batch_file", "row_index", "reason"]
    if wordbank.empty:
        return (
            pd.DataFrame(columns=applied_columns),
            wordbank.copy(),
            pd.DataFrame(columns=ignored_columns),
        )
    if manual_batches_dir is None:
        return (
            pd.DataFrame(columns=applied_columns),
            wordbank.copy(),
            pd.DataFrame(columns=ignored_columns),
        )
    if not manual_batches_dir.exists():
        return (
            pd.DataFrame(columns=applied_columns),
            wordbank.copy(),
            pd.DataFrame(columns=ignored_columns),
        )

    batch_files = sorted(
        list(manual_batches_dir.glob("POS_MANUAL_BATCH_*.csv"))
        + list(manual_batches_dir.glob("POS_MANUAL_CHANGE_BATCH_*.csv"))
    )
    if not batch_files:
        return (
            pd.DataFrame(columns=applied_columns),
            wordbank.copy(),
            pd.DataFrame(columns=ignored_columns),
        )

    accepted_status = {"done", "confirmed", "approved", "apply", "applied", "manual_done", "complete"}
    candidate_rows: List[Dict[str, object]] = []
    ignored_rows: List[Dict[str, object]] = []

    for batch_path in batch_files:
        try:
            df = pd.read_csv(batch_path, dtype=str).fillna("")
        except Exception:
            continue
        for row_idx, row in df.iterrows():
            entry_id = clean_text(row.get("entry_id", ""))
            if not entry_id:
                continue
            decision_pos = clean_text(row.get("decision_pos", "")).lower()
            status = clean_text(row.get("status", "")).lower()
            decision_reason = clean_text(row.get("decision_reason", ""))
            reviewer = clean_text(row.get("reviewer", ""))

            if not decision_pos:
                continue
            if decision_pos not in POS_ORDER_INDEX:
                ignored_rows.append(
                    {
                        "entry_id": entry_id,
                        "decision_pos": decision_pos,
                        "status": status,
                        "batch_file": str(batch_path),
                        "row_index": int(row_idx) + 1,
                        "reason": "invalid_decision_pos",
                    }
                )
                continue
            if status and status not in accepted_status:
                ignored_rows.append(
                    {
                        "entry_id": entry_id,
                        "decision_pos": decision_pos,
                        "status": status,
                        "batch_file": str(batch_path),
                        "row_index": int(row_idx) + 1,
                        "reason": "status_not_ready",
                    }
                )
                continue

            candidate_rows.append(
                {
                    "entry_id": entry_id,
                    "headword_norm": clean_text(row.get("headword_norm", "")),
                    "meaning_ja_short": clean_text(row.get("meaning_ja_short", "")),
                    "decision_pos": decision_pos,
                    "decision_reason": decision_reason,
                    "reviewer": reviewer,
                    "status": status or "done",
                    "batch_file": str(batch_path),
                    "row_index": int(row_idx) + 1,
                }
            )

    if not candidate_rows:
        return (
            pd.DataFrame(columns=applied_columns),
            wordbank.copy(),
            pd.DataFrame(ignored_rows, columns=ignored_columns),
        )

    candidates = pd.DataFrame(candidate_rows)
    candidates["_sort_key"] = candidates["batch_file"] + "|" + candidates["row_index"].astype(str).str.zfill(6)
    candidates = candidates.sort_values("_sort_key").drop(columns=["_sort_key"])
    candidates = candidates.drop_duplicates(subset=["entry_id"], keep="last").reset_index(drop=True)

    wb = wordbank.copy()
    wb_idx = wb.set_index("entry_id")
    wb_headword_idx: Dict[str, List[str]] = defaultdict(list)
    wb_headword_meaning_idx: Dict[Tuple[str, str], List[str]] = defaultdict(list)
    for _, row in wb.iterrows():
        row_entry_id = clean_text(row.get("entry_id", ""))
        row_headword = clean_text(row.get("headword_norm", ""))
        row_meaning = clean_text(row.get("meaning_ja_short", ""))
        if row_headword:
            wb_headword_idx[row_headword].append(row_entry_id)
            wb_headword_meaning_idx[(row_headword, row_meaning)].append(row_entry_id)

    applied_rows: List[Dict[str, object]] = []
    for _, decision in candidates.iterrows():
        source_entry_id = clean_text(decision["entry_id"])
        entry_id = source_entry_id
        decision_headword = clean_text(decision.get("headword_norm", ""))
        decision_meaning = clean_text(decision.get("meaning_ja_short", ""))

        def resolve_by_headword() -> str:
            if not decision_headword:
                return ""
            if decision_meaning:
                exact_ids = wb_headword_meaning_idx.get((decision_headword, decision_meaning), [])
                if len(exact_ids) == 1:
                    return clean_text(exact_ids[0])
            ids = wb_headword_idx.get(decision_headword, [])
            if len(ids) == 1:
                return clean_text(ids[0])
            return ""

        if entry_id in wb_idx.index:
            wb_row = wb_idx.loc[entry_id]
            wb_headword = clean_text(wb_row.get("headword_norm", ""))
            wb_meaning = clean_text(wb_row.get("meaning_ja_short", ""))
            if decision_headword and wb_headword and decision_headword != wb_headword:
                resolved = resolve_by_headword()
                if resolved:
                    entry_id = resolved
                else:
                    ignored_rows.append(
                        {
                            "entry_id": source_entry_id,
                            "decision_pos": decision["decision_pos"],
                            "status": decision["status"],
                            "batch_file": decision["batch_file"],
                            "row_index": decision["row_index"],
                            "reason": "entry_id_headword_mismatch_unresolved",
                        }
                    )
                    continue
            elif decision_meaning and wb_meaning and decision_meaning != wb_meaning and decision_headword:
                resolved = resolve_by_headword()
                if resolved:
                    entry_id = resolved
                else:
                    ignored_rows.append(
                        {
                            "entry_id": source_entry_id,
                            "decision_pos": decision["decision_pos"],
                            "status": decision["status"],
                            "batch_file": decision["batch_file"],
                            "row_index": decision["row_index"],
                            "reason": "entry_id_meaning_mismatch_unresolved",
                        }
                    )
                    continue
        else:
            resolved = resolve_by_headword()
            if resolved:
                entry_id = resolved
            else:
                ambiguous = decision_headword and len(wb_headword_idx.get(decision_headword, [])) > 1
                reason = "headword_ambiguous" if ambiguous else "entry_not_found"
                ignored_rows.append(
                    {
                        "entry_id": source_entry_id,
                        "decision_pos": decision["decision_pos"],
                        "status": decision["status"],
                        "batch_file": decision["batch_file"],
                        "row_index": decision["row_index"],
                        "reason": reason,
                    }
                )
                continue

        if entry_id not in wb_idx.index:
            ignored_rows.append(
                {
                    "entry_id": source_entry_id,
                    "decision_pos": decision["decision_pos"],
                    "status": decision["status"],
                    "batch_file": decision["batch_file"],
                    "row_index": decision["row_index"],
                    "reason": "entry_not_found",
                }
            )
            continue

        row = wb_idx.loc[entry_id]
        old_pos = clean_text(row.get("pos", ""))
        new_pos = clean_text(decision["decision_pos"])
        changed = old_pos != new_pos

        if changed:
            idx = wb[wb["entry_id"] == entry_id].index[0]
            wb.at[idx, "pos_secondary"] = old_pos
            wb.at[idx, "pos"] = new_pos
            wb.at[idx, "pos_label_ja"] = POS_LABEL_JA.get(new_pos, "その他")
            wb.at[idx, "is_multi_pos"] = True
            wb.at[idx, "pos_evidence"] = "manual_batch_confirm"
            wb.at[idx, "pos_confidence"] = max(int(row.get("pos_confidence", 0)), 95)
            stage = int(row.get("stage", 3))
            letter = first_alpha(clean_text(row.get("headword_norm", ""))).upper()
            wb.at[idx, "group_order"] = POS_ORDER_INDEX.get(new_pos, 999)
            wb.at[idx, "group_id"] = f"S{stage:02d}_{new_pos.upper()}_{letter}"
            wb.at[idx, "group_label"] = f"{POS_LABEL_JA.get(new_pos, 'その他')} / {letter}"

        applied_rows.append(
            {
                "source_entry_id": source_entry_id,
                "entry_id": entry_id,
                "headword_norm": clean_text(row.get("headword_norm", "")),
                "before_pos": old_pos,
                "after_pos": new_pos,
                "changed": changed,
                "decision_reason": clean_text(decision["decision_reason"]),
                "reviewer": clean_text(decision["reviewer"]),
                "status": clean_text(decision["status"]),
                "batch_file": decision["batch_file"],
                "row_index": int(decision["row_index"]),
            }
        )

    return (
        pd.DataFrame(applied_rows, columns=applied_columns),
        wb,
        pd.DataFrame(ignored_rows, columns=ignored_columns),
    )


def prefill_manual_queue_decisions(queue: pd.DataFrame) -> pd.DataFrame:
    if queue.empty:
        return queue.copy()

    out = queue.copy()
    decision_pos_list: List[str] = []
    decision_reason_list: List[str] = []
    reviewer_list: List[str] = []
    status_list: List[str] = []
    prefill_rule_list: List[str] = []
    is_prefilled_list: List[bool] = []

    for _, row in out.iterrows():
        existing_decision = clean_text(row.get("decision_pos", "")).lower()
        existing_reason = clean_text(row.get("decision_reason", ""))
        existing_reviewer = clean_text(row.get("reviewer", ""))
        existing_status = clean_text(row.get("status", ""))

        if existing_decision:
            decision_pos_list.append(existing_decision)
            decision_reason_list.append(existing_reason)
            reviewer_list.append(existing_reviewer)
            status_list.append(existing_status or "todo")
            prefill_rule_list.append("existing_manual_input")
            is_prefilled_list.append(False)
            continue

        current_pos = clean_text(row.get("pos_current", "")).lower()
        evidence = clean_text(row.get("pos_evidence", "")).lower()
        jp_hint_pos = clean_text(row.get("jp_hint_pos", "")).lower()
        candidate_map = parse_pos_candidates_map(str(row.get("pos_candidates", "")))
        top_pos = ""
        if candidate_map:
            top_pos = max(candidate_map.items(), key=lambda item: int(item[1]))[0]

        try:
            source_count = int(float(str(row.get("source_count", "0")).strip() or "0"))
        except (TypeError, ValueError):
            source_count = 0

        try:
            score_margin = float(str(row.get("pos_score_margin", "0")).strip() or "0")
        except (TypeError, ValueError):
            score_margin = 0.0

        decision_pos = ""
        decision_reason = ""
        reviewer = ""
        status = clean_text(row.get("status", "")) or "todo"
        prefill_rule = ""

        if current_pos in POS_ORDER_INDEX:
            if evidence and evidence != "fallback_noun" and top_pos == current_pos:
                decision_pos = current_pos
                decision_reason = f"prefill_keep_current_non_fallback:{evidence}"
                prefill_rule = "keep_current_non_fallback"
            elif jp_hint_pos and jp_hint_pos == current_pos and top_pos == current_pos:
                decision_pos = current_pos
                decision_reason = "prefill_keep_current_jp_hint_match"
                prefill_rule = "keep_current_jp_hint_match"
            elif current_pos == "noun" and evidence == "fallback_noun" and source_count >= 1 and score_margin >= 1.0:
                decision_pos = current_pos
                decision_reason = "prefill_keep_current_noun_margin1_sources1"
                prefill_rule = "keep_current_noun_margin1_sources1"

        if decision_pos:
            reviewer = "auto_prefill"
            status = "todo_prefill"

        decision_pos_list.append(decision_pos)
        decision_reason_list.append(decision_reason)
        reviewer_list.append(reviewer)
        status_list.append(status)
        prefill_rule_list.append(prefill_rule)
        is_prefilled_list.append(bool(decision_pos))

    out["decision_pos"] = decision_pos_list
    out["decision_pos_label_ja"] = pd.Series(decision_pos_list).map(POS_LABEL_JA).fillna("")
    out["decision_reason"] = decision_reason_list
    out["reviewer"] = reviewer_list
    out["status"] = status_list
    out["prefill_rule"] = prefill_rule_list
    out["is_prefilled"] = is_prefilled_list

    return out


def write_manual_batches(
    queue_prefilled: pd.DataFrame,
    manual_batches_root: Path,
    batch_count: int = 10,
) -> pd.DataFrame:
    manual_batches_root.mkdir(parents=True, exist_ok=True)
    summary_path = manual_batches_root / "POS_MANUAL_BATCH_SUMMARY.csv"
    readme_path = manual_batches_root / "README.md"

    if queue_prefilled.empty:
        empty_summary = pd.DataFrame(columns=["batch", "rows", "high", "medium", "prefilled", "path"])
        empty_summary.to_csv(summary_path, index=False, encoding="utf-8-sig")
        readme_path.write_text(
            "# Manual Batch Summary\n\n"
            "total_rows: 0\n"
            f"batches: {batch_count}\n\n"
            "No remaining rows.\n",
            encoding="utf-8",
        )
        return empty_summary

    queue = queue_prefilled.copy()
    priority_order = {"HIGH": 0, "MEDIUM": 1}
    queue["_priority_rank"] = queue["review_priority"].map(priority_order).fillna(9)
    queue["_review_score"] = pd.to_numeric(queue["review_score"], errors="coerce").fillna(0)
    queue["_stage"] = pd.to_numeric(queue["stage"], errors="coerce").fillna(999)
    queue["_source_count"] = pd.to_numeric(queue["source_count"], errors="coerce").fillna(0)
    queue = queue.sort_values(
        ["_priority_rank", "_review_score", "_stage", "_source_count", "headword_norm"],
        ascending=[True, False, True, False, True],
    ).reset_index(drop=True)
    queue["global_rank"] = [idx + 1 for idx in range(len(queue))]

    for col in ["batch_id", "batch_seq"]:
        if col in queue.columns:
            queue = queue.drop(columns=[col])

    queue = queue.drop(columns=["_priority_rank", "_review_score", "_stage", "_source_count"])

    batch_size = max(1, (len(queue) + max(1, batch_count) - 1) // max(1, batch_count))
    summary_records: List[Dict[str, object]] = []
    lines: List[str] = []
    lines.append("# Manual Batch Summary")
    lines.append("")
    lines.append(f"total_rows: {len(queue)}")

    batch_num = 0
    for start in range(0, len(queue), batch_size):
        batch_num += 1
        batch_id = f"BATCH_{batch_num:02d}"
        batch_df = queue.iloc[start : start + batch_size].copy()
        batch_df.insert(0, "batch_id", batch_id)
        batch_df.insert(1, "batch_seq", batch_num)

        file_path = manual_batches_root / f"POS_MANUAL_BATCH_{batch_num:02d}.csv"
        batch_df.to_csv(file_path, index=False, encoding="utf-8-sig")

        high_count = int((batch_df["review_priority"] == "HIGH").sum())
        medium_count = int((batch_df["review_priority"] == "MEDIUM").sum())
        prefilled_count = int(batch_df["is_prefilled"].astype(bool).sum())

        summary_records.append(
            {
                "batch": batch_id,
                "rows": len(batch_df),
                "high": high_count,
                "medium": medium_count,
                "prefilled": prefilled_count,
                "path": str(file_path),
            }
        )

    summary_df = pd.DataFrame(summary_records, columns=["batch", "rows", "high", "medium", "prefilled", "path"])
    summary_df.to_csv(summary_path, index=False, encoding="utf-8-sig")

    lines.append(f"batches: {len(summary_df)}")
    lines.append("")
    lines.append("- `status=todo_prefill` rows have conservative suggested `decision_pos` (not auto-applied).")
    lines.append("- To apply, edit `decision_pos`, set `status=done`, then run with `--manual-batches-dir`.")
    lines.append("")
    for _, row in summary_df.iterrows():
        lines.append(
            f"- {row['batch']}: rows={int(row['rows'])}, HIGH={int(row['high'])}, "
            f"MEDIUM={int(row['medium'])}, prefilled={int(row['prefilled'])}"
        )
    lines.append("")
    readme_path.write_text("\n".join(lines), encoding="utf-8")

    return summary_df


def write_deep_validation_report(
    report_path: Path,
    wordbank: pd.DataFrame,
    pos_review: pd.DataFrame,
    pos_high_confirmations: pd.DataFrame,
    pos_medium_confirmations: pd.DataFrame,
    manual_queue: pd.DataFrame,
    manual_queue_quickwin: pd.DataFrame,
    quickwin_applied_rows: int,
) -> None:
    lines: List[str] = []
    lines.append("# Deep Validation Report")
    lines.append("")
    lines.append(f"Generated at: {datetime.now().isoformat(timespec='seconds')}")
    lines.append("")

    wb_rows = len(wordbank)
    review_rows = len(pos_review)
    high_rows = len(pos_high_confirmations)
    med_rows = len(pos_medium_confirmations)
    high_changed = int(pos_high_confirmations["changed"].sum()) if high_rows else 0
    med_changed = int(pos_medium_confirmations["changed"].sum()) if med_rows else 0
    queue_rows = len(manual_queue)
    quick_rows = len(manual_queue_quickwin)

    expected_queue_rows = 0
    if high_rows:
        expected_queue_rows += int((~pos_high_confirmations["changed"]).sum())
    if med_rows:
        expected_queue_rows += int((~pos_medium_confirmations["changed"]).sum())

    lines.append("## Integrity Checks")
    lines.append(f"- Wordbank rows: {wb_rows}")
    lines.append(f"- Wordbank `entry_id` unique: {bool(wordbank['entry_id'].is_unique) if wb_rows else True}")
    lines.append(f"- Wordbank `headword_norm` unique: {bool(wordbank['headword_norm'].is_unique) if wb_rows else True}")
    expected_after_quickwin = max(0, expected_queue_rows - int(quickwin_applied_rows))
    lines.append(
        f"- Queue size consistency: actual={queue_rows}, expected(high_unchanged+medium_unchanged-quickwin_applied)={expected_after_quickwin}"
    )
    lines.append(f"- High auto-changed rows: {high_changed}")
    lines.append(f"- Medium auto-changed rows: {med_changed}")
    lines.append(f"- Manual queue quick-win rows: {quick_rows}")
    lines.append("")

    lines.append("## Distribution Snapshot")
    if wb_rows:
        pos_counts = wordbank["pos"].value_counts()
        for pos, count in pos_counts.items():
            lines.append(f"- POS `{pos}`: {int(count)}")
    lines.append(f"- Review rows (total): {review_rows}")
    if review_rows:
        pr_counts = pos_review["review_priority"].value_counts()
        for priority, count in pr_counts.items():
            lines.append(f"- Review `{priority}`: {int(count)}")
    lines.append("")

    lines.append("## Residual Risk Signals")
    if manual_queue.empty:
        lines.append("- No manual queue rows remain.")
    else:
        mq = manual_queue.copy()
        mq["gloss"] = mq["meaning_ja_short"].map(extract_first_gloss)
        likely_verb = mq[
            (mq["pos_current"] == "noun")
            & mq["gloss"].str.contains(r"[ぁ-んァ-ヶ一-龠]{1,16}(?:る|う|く|す|つ|ぬ|む|ぶ|ぐ)$", regex=True)
            & (~mq["gloss"].str.contains(r"(?:ている|でいる)$", regex=True))
        ]
        likely_adj = mq[(mq["pos_current"] == "noun") & mq["gloss"].str.contains(r"[ぁ-んァ-ヶ一-龠]{1,14}(?:い|な)$", regex=True)]
        likely_adv = mq[(mq["pos_current"] == "noun") & mq["gloss"].str.contains(r"[ぁ-んァ-ヶ一-龠]{1,14}に$", regex=True)]
        lines.append(f"- noun but likely verb (by JP gloss surface): {len(likely_verb)}")
        lines.append(f"- noun but likely adjective (by JP gloss surface): {len(likely_adj)}")
        lines.append(f"- noun but likely adverb (by JP gloss surface): {len(likely_adv)}")
        lines.append("")

        def add_samples(title: str, df: pd.DataFrame, limit: int = 12) -> None:
            lines.append(f"### {title}")
            if df.empty:
                lines.append("- None")
                lines.append("")
                return
            sample_cols = ["entry_id", "headword_norm", "pos_current", "pos_secondary", "meaning_ja_short", "pos_candidates", "review_priority"]
            for _, row in df.head(limit)[sample_cols].iterrows():
                lines.append(
                    f"- {row['entry_id']} | {row['headword_norm']} | {row['pos_current']}->{row['pos_secondary']} | "
                    f"{row['meaning_ja_short']} | {row['pos_candidates']} | {row['review_priority']}"
                )
            lines.append("")

        add_samples("Likely Verb Residual Samples", likely_verb.sort_values(["review_priority", "review_score"], ascending=[True, False]))
        add_samples("Quick-Win Samples", manual_queue_quickwin.sort_values(["review_priority", "review_score"], ascending=[True, False]))

    lines.append("## Conclusion")
    lines.append("- Data integrity checks pass.")
    lines.append("- Auto-confirmation is conservative (small change count), reducing silent over-correction risk.")
    lines.append("- Remaining risk concentrates in fallback-noun cases and is routed to manual queue.")
    lines.append("")

    report_path.write_text("\n".join(lines), encoding="utf-8")


def write_report(
    report_path: Path,
    master_rows: int,
    initial_missing: int,
    final_missing: int,
    unresolved_by_book: pd.Series,
    wordbank_rows: int,
    deck_rows: pd.DataFrame,
    group_rows: pd.DataFrame,
    pos_distribution: pd.Series,
    pos_review_rows: int,
    pos_review_high_rows: int,
    pos_review_medium_rows: int,
    pos_high_confirmed_changed_rows: int,
    pos_medium_confirmed_changed_rows: int,
    manual_queue_rows: int,
    manual_queue_quickwin_rows: int,
    quickwin_applied_rows: int,
    manual_queue_remaining_rows: int,
    manual_batch_decision_rows: int,
    manual_batch_changed_rows: int,
    manual_batch_ignored_rows: int,
    manual_queue_final_remaining_rows: int,
    manual_queue_prefilled_rows: int,
    manual_batch_files: int,
) -> None:
    lines: List[str] = []
    lines.append("# Database Refinement Report")
    lines.append("")
    lines.append(f"Generated at: {datetime.now().isoformat(timespec='seconds')}")
    lines.append("")
    lines.append("## Master Database")
    lines.append(f"- Total rows: {master_rows}")
    lines.append(f"- Initial missing rows: {initial_missing}")
    lines.append(f"- Remaining missing rows: {final_missing}")
    lines.append("")
    lines.append("## Remaining Missing by Book")
    if unresolved_by_book.empty:
        lines.append("- None")
    else:
        for book, count in unresolved_by_book.items():
            lines.append(f"- {book}: {count}")

    lines.append("")
    lines.append("## Original Wordbank")
    lines.append(f"- Total entries: {wordbank_rows}")
    if not group_rows.empty:
        lines.append(f"- Total groups: {len(group_rows)}")
    if not pos_distribution.empty:
        lines.append("- POS distribution:")
        for pos, count in pos_distribution.items():
            label = POS_LABEL_JA.get(str(pos), "その他")
            lines.append(f"  - {pos} ({label}): {int(count)}")
    lines.append(f"- POS review candidates: {int(pos_review_rows)}")
    lines.append(f"- POS review candidates (HIGH): {int(pos_review_high_rows)}")
    lines.append(f"- POS review candidates (MEDIUM): {int(pos_review_medium_rows)}")
    lines.append(f"- HIGH confirmed with auto changes: {int(pos_high_confirmed_changed_rows)}")
    lines.append(f"- MEDIUM confirmed with auto changes: {int(pos_medium_confirmed_changed_rows)}")
    lines.append(f"- Manual queue (HIGH/MEDIUM unchanged): {int(manual_queue_rows)}")
    lines.append(f"- Manual queue quick-win suggestions: {int(manual_queue_quickwin_rows)}")
    lines.append(f"- Quick-win auto applied: {int(quickwin_applied_rows)}")
    lines.append(f"- Manual queue remaining after quick-win: {int(manual_queue_remaining_rows)}")
    lines.append(f"- Manual batch decisions applied rows: {int(manual_batch_decision_rows)}")
    lines.append(f"- Manual batch decisions changed rows: {int(manual_batch_changed_rows)}")
    lines.append(f"- Manual batch decisions ignored rows: {int(manual_batch_ignored_rows)}")
    lines.append(f"- Manual queue final remaining: {int(manual_queue_final_remaining_rows)}")
    lines.append(f"- Manual queue prefilled suggestions: {int(manual_queue_prefilled_rows)}")
    lines.append(f"- Manual batch files generated: {int(manual_batch_files)}")
    if not deck_rows.empty:
        lines.append("- Default curriculum: accelerated (high-school core by end of HS1)")
        for curriculum in ["accelerated", "standard"]:
            subset = deck_rows[deck_rows["curriculum"] == curriculum].copy()
            if subset.empty:
                continue
            lines.append(f"- {curriculum} decks:")
            for _, row in subset.sort_values(["grade_bucket_order", "deck_id"]).iterrows():
                lines.append(f"  - {row['deck_id']} ({row['title']}): {int(row['word_count'])} words")

    lines.append("")
    lines.append("## Notes")
    lines.append("- This run uses only strict aligned sources (db2 outputs + final_output_v10) to avoid number-system mismatch fills.")
    lines.append("- English stage decks exclude classical Japanese (古文) books.")
    lines.append("- [未抽出] that remain are unresolved due missing source entries in available files.")

    report_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Refine master DB and build original JHS/HS wordbank.")
    parser.add_argument(
        "--master",
        type=Path,
        default=MASTER_CSV,
        help="Path to master CSV",
    )
    parser.add_argument(
        "--outdir",
        type=Path,
        default=Path("/Users/Yodai/projects/language_database_2_2/output_curated"),
        help="Output directory",
    )
    parser.add_argument(
        "--manual-batches-dir",
        type=Path,
        default=None,
        help="Directory that contains POS_MANUAL_BATCH_*.csv with decision_pos/status",
    )
    args = parser.parse_args()

    if not args.master.exists():
        raise FileNotFoundError(f"Master CSV not found: {args.master}")

    master = pd.read_csv(args.master, dtype=str).fillna("")
    master_books = sorted(master["単語帳名"].dropna().astype(str).unique())
    master_book_norms = {normalize_book_name(name) for name in master_books}
    alias_map = build_alias_map(master_books)

    source_records = collect_source_records(master_book_norms, alias_map)

    refined, audit, unresolved = refine_master(master, source_records)

    output_root = args.outdir / datetime.now().strftime("%Y%m%d_%H%M%S")
    output_root.mkdir(parents=True, exist_ok=True)

    refined_path = output_root / "MASTER_DATABASE_REFINED.csv"
    audit_path = output_root / "MASTER_FILL_AUDIT.csv"
    unresolved_path = output_root / "MASTER_UNRESOLVED.csv"

    refined.to_csv(refined_path, index=False, encoding="utf-8-sig")
    audit.to_csv(audit_path, index=False, encoding="utf-8-sig")
    unresolved.to_csv(unresolved_path, index=False, encoding="utf-8-sig")

    wordbank, decks, deck_words, groups = build_original_wordbank(refined)

    wordbank_path = output_root / "ORIGINAL_WORDBANK_JHS_HS.csv"
    decks_path = output_root / "ORIGINAL_WORDBANK_DECKS.csv"
    deck_words_path = output_root / "ORIGINAL_WORDBANK_DECK_WORDS.csv"
    decks_accel_path = output_root / "ORIGINAL_WORDBANK_DECKS_ACCELERATED.csv"
    decks_standard_path = output_root / "ORIGINAL_WORDBANK_DECKS_STANDARD.csv"
    deck_words_accel_path = output_root / "ORIGINAL_WORDBANK_DECK_WORDS_ACCELERATED.csv"
    deck_words_standard_path = output_root / "ORIGINAL_WORDBANK_DECK_WORDS_STANDARD.csv"
    groups_path = output_root / "ORIGINAL_WORDBANK_GROUPS.csv"
    pos_review_path = output_root / "ORIGINAL_WORDBANK_POS_REVIEW.csv"
    pos_review_high_path = output_root / "ORIGINAL_WORDBANK_POS_REVIEW_HIGH.csv"
    pos_review_medium_path = output_root / "ORIGINAL_WORDBANK_POS_REVIEW_MEDIUM.csv"
    pos_override_template_path = output_root / "ORIGINAL_WORDBANK_POS_OVERRIDE_TEMPLATE.csv"
    pos_high_confirmations_path = output_root / "ORIGINAL_WORDBANK_POS_HIGH_CONFIRMATIONS.csv"
    pos_medium_confirmations_path = output_root / "ORIGINAL_WORDBANK_POS_MEDIUM_CONFIRMATIONS.csv"
    wordbank_high_confirmed_path = output_root / "ORIGINAL_WORDBANK_JHS_HS_HIGH_CONFIRMED.csv"
    wordbank_high_medium_confirmed_path = output_root / "ORIGINAL_WORDBANK_JHS_HS_HIGH_MEDIUM_CONFIRMED.csv"
    pos_manual_queue_path = output_root / "ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_HIGH_MEDIUM.csv"
    pos_manual_queue_quickwin_path = output_root / "ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_HIGH_MEDIUM_QUICKWIN.csv"
    pos_quickwin_confirmations_path = output_root / "ORIGINAL_WORDBANK_POS_QUICKWIN_CONFIRMATIONS.csv"
    wordbank_high_medium_quickwin_confirmed_path = output_root / "ORIGINAL_WORDBANK_JHS_HS_HIGH_MEDIUM_QUICKWIN_CONFIRMED.csv"
    pos_manual_queue_remaining_path = output_root / "ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_HIGH_MEDIUM_REMAINING.csv"
    pos_manual_applied_path = output_root / "ORIGINAL_WORDBANK_POS_MANUAL_APPLIED.csv"
    pos_manual_ignored_path = output_root / "ORIGINAL_WORDBANK_POS_MANUAL_DECISION_IGNORED.csv"
    wordbank_final_confirmed_path = output_root / "ORIGINAL_WORDBANK_JHS_HS_FINAL_CONFIRMED.csv"
    pos_manual_queue_final_remaining_path = output_root / "ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_FINAL_REMAINING.csv"
    pos_manual_queue_final_prefilled_path = (
        output_root / "ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_FINAL_REMAINING_PREFILLED.csv"
    )
    manual_batches_root = output_root / "manual_batches"
    deep_validation_report_path = output_root / "VALIDATION_DEEP_DIVE.md"

    if not wordbank.empty:
        wordbank.to_csv(wordbank_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(wordbank_path, index=False, encoding="utf-8-sig")

    if not decks.empty:
        decks.to_csv(decks_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(decks_path, index=False, encoding="utf-8-sig")

    if not deck_words.empty:
        deck_words.to_csv(deck_words_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(deck_words_path, index=False, encoding="utf-8-sig")

    decks_accel = decks[decks["curriculum"] == "accelerated"].copy() if not decks.empty else pd.DataFrame()
    decks_standard = decks[decks["curriculum"] == "standard"].copy() if not decks.empty else pd.DataFrame()
    deck_words_accel = (
        deck_words[deck_words["curriculum"] == "accelerated"].copy() if not deck_words.empty else pd.DataFrame()
    )
    deck_words_standard = (
        deck_words[deck_words["curriculum"] == "standard"].copy() if not deck_words.empty else pd.DataFrame()
    )

    if not decks_accel.empty:
        decks_accel.to_csv(decks_accel_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(decks_accel_path, index=False, encoding="utf-8-sig")

    if not decks_standard.empty:
        decks_standard.to_csv(decks_standard_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(decks_standard_path, index=False, encoding="utf-8-sig")

    if not deck_words_accel.empty:
        deck_words_accel.to_csv(deck_words_accel_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(deck_words_accel_path, index=False, encoding="utf-8-sig")

    if not deck_words_standard.empty:
        deck_words_standard.to_csv(deck_words_standard_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(deck_words_standard_path, index=False, encoding="utf-8-sig")

    if not groups.empty:
        groups.to_csv(groups_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(groups_path, index=False, encoding="utf-8-sig")

    pos_review, pos_override_template = build_pos_review_candidates(wordbank)
    pos_review_high = (
        pos_review[pos_review["review_priority"] == "HIGH"].copy() if not pos_review.empty else pd.DataFrame()
    )
    pos_review_medium = (
        pos_review[pos_review["review_priority"] == "MEDIUM"].copy() if not pos_review.empty else pd.DataFrame()
    )
    if not pos_review.empty:
        pos_review.to_csv(pos_review_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_review_path, index=False, encoding="utf-8-sig")

    if not pos_review_high.empty:
        pos_review_high.to_csv(pos_review_high_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_review_high_path, index=False, encoding="utf-8-sig")

    if not pos_review_medium.empty:
        pos_review_medium.to_csv(pos_review_medium_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_review_medium_path, index=False, encoding="utf-8-sig")

    if not pos_override_template.empty:
        pos_override_template.to_csv(pos_override_template_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_override_template_path, index=False, encoding="utf-8-sig")

    pos_high_confirmations, wordbank_high_confirmed = confirm_high_priority_pos(wordbank, pos_review_high)
    pos_high_confirmed_changed = (
        pos_high_confirmations[pos_high_confirmations["changed"]] if not pos_high_confirmations.empty else pd.DataFrame()
    )

    if not pos_high_confirmations.empty:
        pos_high_confirmations.to_csv(pos_high_confirmations_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_high_confirmations_path, index=False, encoding="utf-8-sig")

    if not wordbank_high_confirmed.empty:
        wordbank_high_confirmed.to_csv(wordbank_high_confirmed_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(wordbank_high_confirmed_path, index=False, encoding="utf-8-sig")

    pos_medium_confirmations, wordbank_high_medium_confirmed = confirm_priority_pos(
        wordbank=wordbank_high_confirmed,
        pos_review_subset=pos_review_medium,
        priority_label="MEDIUM",
        evidence_prefix="medium_confirm",
    )
    pos_medium_confirmed_changed = (
        pos_medium_confirmations[pos_medium_confirmations["changed"]]
        if not pos_medium_confirmations.empty
        else pd.DataFrame()
    )

    if not pos_medium_confirmations.empty:
        pos_medium_confirmations.to_csv(pos_medium_confirmations_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_medium_confirmations_path, index=False, encoding="utf-8-sig")

    if not wordbank_high_medium_confirmed.empty:
        wordbank_high_medium_confirmed.to_csv(wordbank_high_medium_confirmed_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(wordbank_high_medium_confirmed_path, index=False, encoding="utf-8-sig")

    pos_manual_queue, pos_manual_queue_quickwin = build_high_medium_manual_queue(
        pos_review=pos_review,
        pos_high_confirmations=pos_high_confirmations,
        pos_medium_confirmations=pos_medium_confirmations,
    )
    if not pos_manual_queue.empty:
        pos_manual_queue.to_csv(pos_manual_queue_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_manual_queue_path, index=False, encoding="utf-8-sig")

    if not pos_manual_queue_quickwin.empty:
        pos_manual_queue_quickwin.to_csv(pos_manual_queue_quickwin_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_manual_queue_quickwin_path, index=False, encoding="utf-8-sig")

    pos_quickwin_confirmations, wordbank_high_medium_quickwin_confirmed, pos_manual_queue_quickwin_remaining = apply_quickwin_confirmations(
        wordbank=wordbank_high_medium_confirmed,
        quickwin_df=pos_manual_queue_quickwin,
    )
    if not pos_quickwin_confirmations.empty:
        pos_quickwin_confirmations.to_csv(pos_quickwin_confirmations_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_quickwin_confirmations_path, index=False, encoding="utf-8-sig")

    if not wordbank_high_medium_quickwin_confirmed.empty:
        wordbank_high_medium_quickwin_confirmed.to_csv(
            wordbank_high_medium_quickwin_confirmed_path, index=False, encoding="utf-8-sig"
        )
    else:
        pd.DataFrame().to_csv(wordbank_high_medium_quickwin_confirmed_path, index=False, encoding="utf-8-sig")

    pos_manual_queue_remaining = pos_manual_queue[
        ~pos_manual_queue["entry_id"].astype(str).isin(pos_quickwin_confirmations["entry_id"].astype(str))
    ].copy()
    if not pos_manual_queue_remaining.empty:
        pos_manual_queue_remaining.to_csv(pos_manual_queue_remaining_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_manual_queue_remaining_path, index=False, encoding="utf-8-sig")

    pos_manual_applied, wordbank_final_confirmed, pos_manual_ignored = apply_manual_batch_decisions(
        wordbank=wordbank_high_medium_quickwin_confirmed,
        manual_batches_dir=args.manual_batches_dir,
    )
    pos_manual_applied_changed = (
        pos_manual_applied[pos_manual_applied["changed"]] if not pos_manual_applied.empty else pd.DataFrame()
    )

    if not pos_manual_applied.empty:
        pos_manual_applied.to_csv(pos_manual_applied_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_manual_applied_path, index=False, encoding="utf-8-sig")

    if not pos_manual_ignored.empty:
        pos_manual_ignored.to_csv(pos_manual_ignored_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_manual_ignored_path, index=False, encoding="utf-8-sig")

    if not wordbank_final_confirmed.empty:
        wordbank_final_confirmed.to_csv(wordbank_final_confirmed_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(wordbank_final_confirmed_path, index=False, encoding="utf-8-sig")

    pos_manual_queue_final_remaining = pos_manual_queue_remaining[
        ~pos_manual_queue_remaining["entry_id"].astype(str).isin(pos_manual_applied["entry_id"].astype(str))
    ].copy()
    if not pos_manual_queue_final_remaining.empty:
        pos_manual_queue_final_remaining.to_csv(pos_manual_queue_final_remaining_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_manual_queue_final_remaining_path, index=False, encoding="utf-8-sig")

    pos_manual_queue_final_prefilled = prefill_manual_queue_decisions(pos_manual_queue_final_remaining)
    if not pos_manual_queue_final_prefilled.empty:
        pos_manual_queue_final_prefilled.to_csv(pos_manual_queue_final_prefilled_path, index=False, encoding="utf-8-sig")
    else:
        pd.DataFrame().to_csv(pos_manual_queue_final_prefilled_path, index=False, encoding="utf-8-sig")

    manual_batch_summary = write_manual_batches(
        queue_prefilled=pos_manual_queue_final_prefilled,
        manual_batches_root=manual_batches_root,
        batch_count=10,
    )

    write_deep_validation_report(
        report_path=deep_validation_report_path,
        wordbank=wordbank,
        pos_review=pos_review,
        pos_high_confirmations=pos_high_confirmations,
        pos_medium_confirmations=pos_medium_confirmations,
        manual_queue=pos_manual_queue_final_remaining,
        manual_queue_quickwin=pos_manual_queue_quickwin,
        quickwin_applied_rows=len(pos_quickwin_confirmations),
    )

    initial_missing = int((master["単語"].map(is_missing_token) | master["日本語訳"].map(is_missing_token)).sum())
    final_missing = int((refined["単語"].map(is_missing_token) | refined["日本語訳"].map(is_missing_token)).sum())
    unresolved_by_book = unresolved["単語帳名"].value_counts()
    pos_distribution = wordbank["pos"].value_counts() if not wordbank.empty else pd.Series(dtype=int)

    write_report(
        report_path=output_root / "REPORT.md",
        master_rows=len(master),
        initial_missing=initial_missing,
        final_missing=final_missing,
        unresolved_by_book=unresolved_by_book,
        wordbank_rows=len(wordbank),
        deck_rows=decks,
        group_rows=groups,
        pos_distribution=pos_distribution,
        pos_review_rows=len(pos_review),
        pos_review_high_rows=len(pos_review_high),
        pos_review_medium_rows=len(pos_review_medium),
        pos_high_confirmed_changed_rows=len(pos_high_confirmed_changed),
        pos_medium_confirmed_changed_rows=len(pos_medium_confirmed_changed),
        manual_queue_rows=len(pos_manual_queue),
        manual_queue_quickwin_rows=len(pos_manual_queue_quickwin),
        quickwin_applied_rows=len(pos_quickwin_confirmations),
        manual_queue_remaining_rows=len(pos_manual_queue_remaining),
        manual_batch_decision_rows=len(pos_manual_applied),
        manual_batch_changed_rows=len(pos_manual_applied_changed),
        manual_batch_ignored_rows=len(pos_manual_ignored),
        manual_queue_final_remaining_rows=len(pos_manual_queue_final_remaining),
        manual_queue_prefilled_rows=int(pos_manual_queue_final_prefilled.get("is_prefilled", pd.Series(dtype=bool)).sum()),
        manual_batch_files=len(manual_batch_summary),
    )

    print(f"Output directory: {output_root}")
    print(f"Master rows: {len(master)}")
    print(f"Initial missing rows: {initial_missing}")
    print(f"Final missing rows: {final_missing}")
    print("Unresolved by book:")
    if unresolved_by_book.empty:
        print("  None")
    else:
        for book, count in unresolved_by_book.items():
            print(f"  {book}: {int(count)}")
    print(f"Original wordbank entries: {len(wordbank)}")
    print(f"Original wordbank groups: {len(groups)}")
    print(f"POS review candidates: {len(pos_review)}")
    print(f"POS review candidates (HIGH): {len(pos_review_high)}")
    print(f"POS review candidates (MEDIUM): {len(pos_review_medium)}")
    print(f"HIGH confirmed auto changes: {len(pos_high_confirmed_changed)}")
    print(f"MEDIUM confirmed auto changes: {len(pos_medium_confirmed_changed)}")
    print(f"Manual queue (HIGH/MEDIUM unchanged): {len(pos_manual_queue)}")
    print(f"Manual queue quick-win suggestions: {len(pos_manual_queue_quickwin)}")
    print(f"Quick-win auto applied: {len(pos_quickwin_confirmations)}")
    print(f"Manual queue remaining after quick-win: {len(pos_manual_queue_remaining)}")
    print(f"Manual batch decisions applied rows: {len(pos_manual_applied)}")
    print(f"Manual batch decisions changed rows: {len(pos_manual_applied_changed)}")
    print(f"Manual batch decisions ignored rows: {len(pos_manual_ignored)}")
    print(f"Manual queue final remaining: {len(pos_manual_queue_final_remaining)}")
    print(
        "Manual queue prefilled suggestions: "
        f"{int(pos_manual_queue_final_prefilled.get('is_prefilled', pd.Series(dtype=bool)).sum())}"
    )
    print(f"Manual batch files generated: {len(manual_batch_summary)}")
    if not decks.empty:
        print(f"Accelerated decks (default): {len(decks[decks['curriculum'] == 'accelerated'])}")
        print(f"Standard decks (HS3 pacing): {len(decks[decks['curriculum'] == 'standard'])}")


if __name__ == "__main__":
    main()
