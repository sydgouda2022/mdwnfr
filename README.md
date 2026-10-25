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

The pinned headless Hieroglyphic Keyboard API v2 lives under `web/vendor/hieroglyphic/` and owns sign lookup, native Unicode predictions and dictionary integrity. It runs in `web/keyboard-prediction-worker.mjs`. Python owns document validation, transactions and quadrat layout only; no duplicate prediction implementation is bundled. The historical corpus remains incomplete, and local recovery history is not an external backup.

## Portable backups

The library supports per-document `.mdwnfr.json` Export and Import. Imported documents pass Python validation, and duplicate document IDs are rejected without overwriting content. Keep exports outside the browser to survive data clearing or device loss.

Keyboard dependency upgrades require a reviewed change; CI verifies the pinned release without pushing automatically to main.

The iPhone/iPad drawing surface uses 44 CSS-pixel resize handles; document margins now govern papyrus viewport lookup and image drag geometry. All imported/pasted document glyphs must be supported by the bundled rendering font.

The production browser build derives `keyboard-release-pin.json` from the reviewed `keyboard-lock.json`, validates the published lexicon bytes, and precaches the exact pin for offline keyboard initialization. The API's source notices are included under `web/vendor/hieroglyphic/`.

Deleting a document also removes its per-document prediction preferences. CI runs storage-recovery, facing, and layout-detail guard tests in addition to the browser suite.

The headless API v2 caps one prediction result window at 80 entries. The editor labels expanded results accordingly; it does not claim that 80 predictions exhaust the 41,330-record corpus.

Document library order reflects successful IndexedDB save times. Keyboard Enter/Space works on cartouches and table cells, and the layout worker can be restarted after fatal initialization errors without a permanently pending layout request.

## Packaged browser assets

The PWA and source now contain a single pinned prediction implementation: the independent headless keyboard API with one browser lexicon. Redundant Python predictor, duplicate database, standalone legacy sign catalog, and legacy lexicon installer have been removed from MdwNfr. Independent keyboard development and dataset compilation belong in `sydgouda2022/hieroglyphic-keyboard`. The verified editor still runs entirely offline after its complete runtime installs. See `docs/RECOVERY_AND_CLIPBOARD.md` for data-safety limits.


## Reliability and responsive editing

- Autosave uses persisted-revision checks. Failed saves expose a recovery export and uncommitted changes warn on tab close.
- My Words can be added, browsed, edited, and deleted. Profile updates are serialized by IndexedDB across tabs.
- Table-cell and cartouche formatting is undoable through Python-validated replace operations; replacing nested text retains existing word styles.
- Pages show bounded miniatures derived from actual Python layout coordinates. Fully completed, word-only pages ahead of illustrated edits can be reused safely; artwork-influenced pages still recompute.
- The isolated Pyodide layout worker is started on demand and released after 45 seconds idle. Returning to Documents releases it immediately. Detail requests restore authoritative layout when needed.
- The inspector exposes page margins, while its sole bundled font is displayed as a label rather than a nonfunctional menu.
- CI verifies native formatting, recovery transactions, pinned keyboard source, Chromium/WebKit touch workflows and offline startup. Production cutover remains explicitly gated.
