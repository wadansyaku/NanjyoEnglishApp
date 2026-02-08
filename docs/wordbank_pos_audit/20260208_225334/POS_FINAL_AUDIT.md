# POS Final Audit

## Summary
- Wordbank rows: 13599
- Manual queue final remaining: 0
- Explicit-tag comparison rows: 362
- Explicit-tag mismatch rows: 6

## Resolved in This Pass
- Added robust decision matching in `apply_manual_batch_decisions` using `entry_id` plus `headword_norm` / `meaning_ja_short` fallback.
- Reclassified pronouns/determiners/quantifiers to `function` via `FUNCTION_WORDS` expansion and post-audit decisions.
- Applied deep manual fixes for explicit-tag conflicts (noun/verb/adjective/adverb mismatches).

## Remaining Edge Cases (Reviewed)
- WB001300 `acid rain`: pos=phrase, tags=noun, evidence=phrase_pattern -> multi-word expression is intentionally kept as `phrase`.
- WB002171 `audience`: pos=noun, tags=adverb, evidence=explicit_tag:noun -> `[副]` appears as annotation noise in meaning text; lexical POS remains noun.
- WB001510 `less`: pos=function, tags=adverb, evidence=function_word_list -> mapped to `function` as determiner/quantifier in this schema.
- WB002867 `major`: pos=adjective, tags=noun,verb, evidence=explicit_primary_tag:adjective -> primary sense in this entry is adjective despite additional noun/verb tags.
- WB001165 `metal`: pos=noun, tags=adverb, evidence=manual_batch_confirm -> `[副]` appears as annotation noise in meaning text; lexical POS remains noun.
- WB001408 `new york`: pos=phrase, tags=noun, evidence=phrase_pattern -> multi-word expression is intentionally kept as `phrase`.