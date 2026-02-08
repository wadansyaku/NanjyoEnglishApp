# Database Refinement Report

Generated at: 2026-02-08T22:54:02

## Master Database
- Total rows: 56472
- Initial missing rows: 975
- Remaining missing rows: 582

## Remaining Missing by Book
- 英検準1級単熟語EX 第2版: 581
- 英単語Stock4500: 1

## Original Wordbank
- Total entries: 13599
- Total groups: 478
- POS distribution:
  - noun (名詞): 4930
  - phrase (熟語): 3829
  - verb (動詞): 2631
  - adjective (形容詞): 1776
  - adverb (副詞): 351
  - function (機能語): 82
- POS review candidates: 4218
- POS review candidates (HIGH): 1221
- POS review candidates (MEDIUM): 1348
- HIGH confirmed with auto changes: 0
- MEDIUM confirmed with auto changes: 0
- Manual queue (HIGH/MEDIUM unchanged): 2569
- Manual queue quick-win suggestions: 6
- Quick-win auto applied: 6
- Manual queue remaining after quick-win: 2563
- Manual batch decisions applied rows: 2977
- Manual batch decisions changed rows: 106
- Manual batch decisions ignored rows: 0
- Manual queue final remaining: 0
- Manual queue prefilled suggestions: 0
- Manual batch files generated: 0
- Default curriculum: accelerated (high-school core by end of HS1)
- accelerated decks:
  - DECK_ACC_G7_JHS1 (中1基礎): 1549 words
  - DECK_ACC_G8_JHS2 (中2標準): 183 words
  - DECK_ACC_G9_JHS3 (中3発展): 4177 words
  - DECK_ACC_G10_HS1 (高1完了(速習)): 2378 words
  - DECK_ACC_G11_HS2 (高2発展(速習)): 1888 words
  - DECK_ACC_G12_HS3 (高3最難関(速習)): 3424 words
- standard decks:
  - DECK_STD_G7_JHS1 (中1基礎(標準)): 1605 words
  - DECK_STD_G8_JHS2 (中2標準(標準)): 186 words
  - DECK_STD_G9_JHS3 (中3発展(標準)): 1883 words
  - DECK_STD_G10_HS1 (高1基礎(標準)): 1988 words
  - DECK_STD_G11_HS2 (高2標準(標準)): 1306 words
  - DECK_STD_G12_HS3 (高3発展(標準)): 6631 words

## Notes
- This run uses only strict aligned sources (db2 outputs + final_output_v10) to avoid number-system mismatch fills.
- English stage decks exclude classical Japanese (古文) books.
- [未抽出] that remain are unresolved due missing source entries in available files.