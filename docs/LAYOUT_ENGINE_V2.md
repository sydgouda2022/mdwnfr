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

Performance: The v2 compositor reflows changed object streams from the start with cached quadrat composition. Identical streams reuse their completed snapshots. Future partial-page caching can be added without restoring per-object wrapping procedures.
