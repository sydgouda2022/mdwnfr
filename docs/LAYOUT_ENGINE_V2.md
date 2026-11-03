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

Current documents contain persistent symbol_ids for every word. Compact page detail is a projection of the one authoritative layout.

Performance: Changes after a proven independent fixed-paper page boundary reuse the unchanged preceding pages and recompose only the remaining stream; otherwise layout reflows from the beginning. Cached quadrat composition is retained. Inside a pass, the compositor reuses legal glyph origins for repeated spellings within unchanged obstacle fields, indexes completed word ink by reading column when evaluating artwork anchors, and intersects divider spans with a linear sweep. These are **search optimizations only**: they must not change the canonical layout geometry or introduce another wrapping engine. Identical streams reuse their completed snapshots.

Use `PYTHONPATH=core python tools/benchmark_layout_v2.py --words 2000 --artworks 8` to record full layout, midstream insertion, and compact projection timings on comparable hardware. The Python unit suite checks indexed-anchor and divider parity against unindexed reference calculations and verifies large mixed-document order and full/compact equivalence. Performance numbers are diagnostic, not fixed CI gates, because runners vary.


## Completed-page prefix reuse

A later edit may reuse completed pages **only** if the old and new document
have identical typography/paper/metrics and an unchanged source prefix.
The boundary must split an unchanged, contiguous object prefix from its
suffix, with no table continuation or other object crossing it. Crucially,
recomposing the ORIGINAL suffix independently must reproduce the old page
geometry exactly; this also admits early page breaks around artwork. The
new suffix then calls the
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


## Appearance-only edits (paper and papyrus)

Word **ink color** is not a positioning input. When a revision changes only
colors of existing top-level word objects, the compositor validates the entire
source stream, retains the old full or compact geometry snapshot and updates
only detailed word ink colors. The result has the current revision and reports
`layout_stats.mode = style_only` with zero recomputed columns. All object IDs,
glyph positions, clearances and page/column divisions stay authoritative and
unchanged. The compact layout carries no styles; its visible-page expansion
reads the latest canonical document, just like full recomposition.

Bold, sign replacements, image size, paper, direction, or glyph metrics **do**
affect layout and invalidate this path. There is no new persisted format or
independent browser geometry. This optimization also works on papyrus because
it does not depend on finished-page boundaries.

Run `PYTHONPATH=core python tools/benchmark_layout_v2.py --surface papyrus --words 900 --artworks 6 --edit-kind color --require-style-reuse`
to compare the edit cost against a full composition, with exact geometry parity
checked each time.


## Papyrus contour-query acceleration

The same 256×256 artwork silhouettes remain the only collision source.
For repeated glyph/column interactions, the engine caches the silhouette's
occupied row intervals for a precise horizontal pixel interval and reflection
mode. Physical page coordinates, word heights, scaling and the required
quarter-column clearance are applied **after** the cache lookup, so results
still use exact original pixel cells and preserve transparent gaps.
This is a bounded, in-memory optimization only: no document changes,
browser wrapping rules, saved positions or compatibility layer.
The regression test `qa/test_silhouette_projection_cache.py` directly compares
the cached calculation against the original row-by-row method for real
Bennu, Horus and Amun masks, including LTR/RTL document reflow. Benchmark
using `PYTHONPATH=core python tools/benchmark_layout_v2.py --surface papyrus --words 900 --artworks 6 --edit-kind insert`.
The benchmark reports the projection cache hits and misses alongside
end-to-end layout timings. The numerical speedup depends on the document
and font geometry; it is not a fixed contractual threshold.
