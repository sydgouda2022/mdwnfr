# MdwNfr Layout Engine 2 — object sequence contract

The document is an ordered array of persistent objects. Every object has an ID, a type and content-specific properties. Objects do not store page, column, line or viewport coordinates.

- A text word is a quadrat object. Its signs are native Egyptian Unicode characters and its symbol_ids identify the corresponding symbol atoms in reading order. Editing preserves matching atom IDs and creates new IDs only for inserted glyphs.
- Imported pre-v2 words without symbol_ids are still accepted. Atom IDs are derived deterministically from word ID and symbol index until an edit materializes them. Validation never mutates existing files.
- Clip art, embedded images, tables and cartouches are persistent objects with unique IDs. Tables and cartouches contain their own word/quadrat IDs. Children are typeset within their owners.
- Every non-text object exposes a measured silhouette and the same quarter-column clearance. It is a writing-region obstacle, not a permanently owned block of columns.
- Quadrats are visited in stream order. The compositor finds the first fitting reading lane and legal origin, testing actual glyph ink against placed silhouettes. A gap is valid only when a whole quadrat cannot fit or filling it would violate sequence.
- Pages, columns, text runs, divider strokes and rendered coordinates are ephemeral. Changing paper, margins or preceding/following objects recomposes geometry from the same persistent IDs and order.
- Output includes per-symbol IDs on quadrat glyphs, so the UI mirrors Python geometry without inventing its own object identities.

The independent headless Hieroglyphic Keyboard API supplies signs and predictions but does not own document objects, geometry or layout.

Compatibility: Existing JSON exports remain valid; schema 1 gains an optional symbol_ids field. The compact page view is a projection of the same layout decisions.

Performance: Changed object streams still reflow from the start, with cached quadrat composition. Inside a pass, the compositor reuses legal glyph origins for repeated spellings within unchanged obstacle fields, indexes completed word ink by reading column when evaluating artwork anchors, and intersects divider spans with a linear sweep. These are **search optimizations only**: they must not change the canonical layout geometry or introduce another wrapping engine. Identical streams reuse their completed snapshots.

Use `PYTHONPATH=core python tools/benchmark_layout_v2.py --words 2000 --artworks 8` to record full layout, midstream insertion, and compact projection timings on comparable hardware. The Python unit suite checks indexed-anchor and divider parity against unindexed reference calculations and verifies large mixed-document order and full/compact equivalence. Performance numbers are diagnostic, not fixed CI gates, because runners vary.


## Completed-page prefix reuse

A later edit may reuse completed pages **only** if the old and new document
have identical typography/paper/metrics and an unchanged source prefix.
The boundary must follow a fully consumed fixed-paper writing grid, contain
no split object/table continuation, and start the following page with the
same unchanged quadrat in writing slot zero. The suffix then calls the
**same** `_layout` compositor on its remaining ordered objects; no second
wrapping algorithm or saved page positions are introduced. Papyrus, early
edits, changed layout settings and ambiguous boundaries recompute in full.
The resulting `layout_stats.mode` is `complete_page_prefix`, with the
reused column count and first recomputed object index reported explicitly.
All original object IDs, symbols and glyph ink geometry remain authoritative.

Benchmark a late edit on a multi-page document with:
`PYTHONPATH=core python tools/benchmark_layout_v2.py --surface A4 --font-size 18 --words 1000 --artworks 4 --edit-at 0.9`.
This measures incremental and full recomposition independently and checks
the results for exact equality, but timing varies with hardware. Compact and
detailed page parity and invalidation scenarios are covered by
`qa/test_layout_page_prefix.py`.
