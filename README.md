# MdwNfr — Hieroglyphic Writing Editor

Independently owned Python document model, hieroglyphic text
compositor, page geometry, iPad/iPhone editor and offline PWA,
migrated from `sydgouda2022/aaa/mdwnfr`.

Native hieroglyphic predictive input and its lexicon are imported
exclusively from `sydgouda2022/hieroglyphic-keyboard`, with exact
source commit and SHA-256 checksum in `keyboard-lock.json`.
Neither MdwNfr nor Renpet edits the keyboard's source database.
Production Cloudflare deployment remains with the original
repository until an explicit migration cutover.

## Headless keyboard API

The public Hieroglyphic Keyboard API v2 is pinned in `web/vendor/hieroglyphic/` and supplies sign lookup. The existing Python prediction bridge remains until the consumer migration is tested. MdwNfr still owns editing, documents and layout. The lexicon is incomplete. Local recovery snapshots are not external backups.

The browser predictor now runs in `web/keyboard-prediction-worker.mjs`, using the independent verified headless v2 API. Python remains the document and quadrat authority; its older prediction RPC is retained for native test compatibility only.

## Portable backups

The library supports per-document `.mdwnfr.json` Export and Import. Imported documents pass Python validation, and duplicate document IDs are rejected without overwriting content. Keep exports outside the browser to survive data clearing or device loss.

Keyboard dependency upgrades require a reviewed change; CI verifies the pinned release without pushing automatically to main.

The iPhone/iPad drawing surface uses 44 CSS-pixel resize handles; document margins now govern papyrus viewport lookup and image drag geometry. All imported/pasted document glyphs must be supported by the bundled rendering font.

The production browser build derives `keyboard-release-pin.json` from the reviewed `keyboard-lock.json`, validates the published lexicon bytes, and precaches the exact pin for offline keyboard initialization. The API's source notices are included under `web/vendor/hieroglyphic/`.

Deleting a document also removes its per-document prediction preferences. CI runs storage-recovery, facing, and layout-detail guard tests in addition to the browser suite.
