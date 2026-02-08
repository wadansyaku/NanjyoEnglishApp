# Wordbank POS Freeze (2026-02-08)

This snapshot freezes the final POS decisions validated in the 2026-02-08 audit pass.

Included:
- `ORIGINAL_WORDBANK_JHS_HS_FINAL_CONFIRMED.csv`: final POS-assigned wordbank.
- `ORIGINAL_WORDBANK_POS_MANUAL_APPLIED.csv`: all applied manual decisions.
- `ORIGINAL_WORDBANK_POS_MANUAL_QUEUE_FINAL_REMAINING.csv`: empty (remaining = 0).
- `POS_FINAL_AUDIT.md`: final validation notes and edge-case rationale.
- `build_refined_wordbanks.py`: exact generator script used.
- `manual_batches_full_done_v6/`: full manual decision batches, including post-audit override files (`..._99`, `..._100`, `..._200`, `..._300`, `..._999`).

Rebuild command used:

```bash
python3 /Users/Yodai/projects/language_database_2_2/build_refined_wordbanks.py \
  --manual-batches-dir /Users/Yodai/projects/language_database_2_2/output_curated/20260208_223343/manual_batches_full_done_v6
```
